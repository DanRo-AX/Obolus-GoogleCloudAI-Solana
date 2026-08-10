use std::process::ExitCode;

use openshelf_api::rollback_sweep::RollbackSweepLedger;
use serde_json::json;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("rollback recovery hold resolution failed: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    if std::env::var("OPENSHELF_RESTORE_RESOLVE_ACK").as_deref()
        != Ok("payments-stopped-and-external-receipts-reconciled")
    {
        return Err(
            "set OPENSHELF_RESTORE_RESOLVE_ACK=payments-stopped-and-external-receipts-reconciled only after every payment ingress and payout worker is stopped and the incident's external receipts are reconciled"
                .to_owned(),
        );
    }
    let database = required_env("OPENSHELF_DATABASE")?;
    let recovery_id = required_env("OPENSHELF_RESTORE_ID")?;
    let evidence = required_env("OPENSHELF_RESTORE_RESOLUTION_EVIDENCE")?;
    let mut ledger = RollbackSweepLedger::connect_postgres(&database)
        .map_err(|error| format!("could not open restored ledger: {error}"))?;
    let resolved = ledger
        .resolve_recovery_holds(&recovery_id, &evidence)
        .map_err(|error| error.to_string())?;
    println!(
        "{}",
        json!({
            "type": "rollback_recovery_hold_resolution",
            "recoveryId": recovery_id,
            "resolved": resolved,
            "resolutionEvidence": evidence,
            "trafficMayBeResumedOnlyAfterReadinessAndReconcilerChecks": true,
        })
    );
    Ok(())
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required"))
}
