use std::process::ExitCode;

use openshelf_api::{
    rollback_audit::RollbackAudit,
    rollback_sweep::{RollbackCoverage, RollbackSweepLedger},
};
use serde_json::json;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(0) => ExitCode::SUCCESS,
        Ok(_) => ExitCode::from(2),
        Err(error) => {
            eprintln!("rollback audit sweep failed: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<usize, String> {
    if std::env::var("OPENSHELF_RESTORE_SWEEP_ACK").as_deref() != Ok("payments-stopped-and-drained")
    {
        return Err(
            "set OPENSHELF_RESTORE_SWEEP_ACK=payments-stopped-and-drained only after all payment ingress and payout workers are stopped and every in-flight authorization request has drained"
                .to_owned(),
        );
    }
    let database = required_env("OPENSHELF_DATABASE")?;
    let recovery_id = required_env("OPENSHELF_RESTORE_ID")?;
    let start_ms = parse_time("OPENSHELF_ROLLBACK_START_MS")?;
    let end_ms = parse_time("OPENSHELF_ROLLBACK_END_MS")?;
    let ledger = RollbackSweepLedger::connect_postgres(&database)
        .map_err(|error| format!("could not open restored ledger: {error}"))?;
    let mut holds_installed = usize::from(
        ledger
            .install_window_hold(&recovery_id, start_ms, end_ms)
            .map_err(|error| format!("could not install rollback window hold: {error}"))?,
    );
    // Install the window hold before the independent ledger is contacted. A
    // GCS outage, malformed object, or process death must leave the restored
    // database stopped rather than converting a failed sweep into permission.
    let audit = RollbackAudit::from_environment(true).map_err(|error| error.to_string())?;
    let records = audit
        .list_intents_created_between(start_ms, end_ms)
        .await
        .map_err(|error| error.to_string())?;
    let model_records = audit
        .list_model_calls_created_between(start_ms, end_ms)
        .await
        .map_err(|error| error.to_string())?;
    let mut uncovered = 0_usize;
    for record in &records {
        let coverage = ledger
            .inspect(&record.intent)
            .map_err(|error| format!("could not inspect {}: {error}", record.object_name))?;
        let (state, detail) = match coverage {
            RollbackCoverage::Covered(detail) => ("covered", detail),
            RollbackCoverage::Missing => {
                uncovered += 1;
                let detail = "no exact attempt, settlement, or payout claim";
                holds_installed += usize::from(
                    ledger
                        .install_payment_hold(
                            &recovery_id,
                            &record.object_name,
                            record.created_at_ms,
                            &record.intent,
                            detail,
                        )
                        .map_err(|error| {
                            format!("could not hold {}: {error}", record.object_name)
                        })?,
                );
                ("missing", detail)
            }
            RollbackCoverage::Mismatch(detail) => {
                uncovered += 1;
                holds_installed += usize::from(
                    ledger
                        .install_payment_hold(
                            &recovery_id,
                            &record.object_name,
                            record.created_at_ms,
                            &record.intent,
                            detail,
                        )
                        .map_err(|error| {
                            format!("could not hold {}: {error}", record.object_name)
                        })?,
                );
                ("mismatch", detail)
            }
        };
        println!(
            "{}",
            json!({
                "type": "rollback_audit_record",
                "object": record.object_name,
                "createdAtMs": record.created_at_ms,
                "rail": record.intent.rail(),
                "operation": record.intent.operation(),
                "eventId": record.intent.event_id(),
                "quoteId": record.intent.quote_id(),
                "jobId": record.intent.job_id(),
                "coverage": state,
                "detail": detail,
            })
        );
    }
    for record in &model_records {
        let coverage = ledger
            .inspect_model_call(&record.intent)
            .map_err(|error| format!("could not inspect {}: {error}", record.object_name))?;
        let (state, detail) = match coverage {
            RollbackCoverage::Covered(detail) => ("covered", detail),
            RollbackCoverage::Missing => {
                uncovered += 1;
                let detail = "no exact model generation attempt";
                holds_installed += usize::from(
                    ledger
                        .install_model_hold(
                            &recovery_id,
                            &record.object_name,
                            record.created_at_ms,
                            &record.intent,
                            detail,
                        )
                        .map_err(|error| {
                            format!("could not hold {}: {error}", record.object_name)
                        })?,
                );
                ("missing", detail)
            }
            RollbackCoverage::Mismatch(detail) => {
                uncovered += 1;
                holds_installed += usize::from(
                    ledger
                        .install_model_hold(
                            &recovery_id,
                            &record.object_name,
                            record.created_at_ms,
                            &record.intent,
                            detail,
                        )
                        .map_err(|error| {
                            format!("could not hold {}: {error}", record.object_name)
                        })?,
                );
                ("mismatch", detail)
            }
        };
        println!(
            "{}",
            json!({
                "type": "rollback_provider_record",
                "object": record.object_name,
                "createdAtMs": record.created_at_ms,
                "operation": record.intent.operation(),
                "inputHash": record.intent.input_hash(),
                "windowStartedAt": record.intent.window_started_at(),
                "coverage": state,
                "detail": detail,
            })
        );
    }
    println!(
        "{}",
        json!({
            "type": "rollback_audit_summary",
            "recoveryId": recovery_id,
            "startMs": start_ms,
            "endMs": end_ms,
            "paymentRecords": records.len(),
            "providerRecords": model_records.len(),
            "uncovered": uncovered,
            "holdsInstalled": holds_installed,
            "recoveryHoldActive": true,
            "ledgerCoverageComplete": uncovered == 0,
            "externalReconciliationStillRequired": true,
        })
    );
    Ok(uncovered)
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

fn parse_time(name: &str) -> Result<u64, String> {
    required_env(name)?
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an unsigned Unix timestamp in milliseconds"))
}
