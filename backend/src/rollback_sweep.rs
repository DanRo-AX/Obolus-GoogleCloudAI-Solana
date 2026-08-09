use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    db::{Connection, OptionalExtension},
    params,
    rollback_audit::{ModelCallAuditIntent, RollbackAuditIntent},
    store::fully_signed_solana_transaction_signature,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RollbackCoverage {
    Covered(&'static str),
    Missing,
    Mismatch(&'static str),
}

#[derive(Debug, Error)]
pub enum RollbackSweepError {
    #[error("rollback sweep requires a PostgreSQL connection string")]
    PostgreSqlRequired,
    #[error("rollback audit intent has an unsupported rail or operation")]
    UnsupportedIntent,
    #[error("rollback audit intent is missing {0}")]
    Incomplete(&'static str),
    #[error("rollback recovery identity or evidence is invalid")]
    InvalidRecoveryIdentity,
    #[error("rollback recovery hold conflicts with an existing hold")]
    HoldConflict,
    #[error("rollback recovery has no unresolved hold for this recovery id")]
    NoUnresolvedHold,
    #[error(transparent)]
    RecoverySchema(#[from] crate::store::StoreError),
    #[error(transparent)]
    Database(#[from] crate::db::Error),
}

pub struct RollbackSweepLedger {
    connection: Connection,
}

impl RollbackSweepLedger {
    pub fn connect_postgres(database: &str) -> Result<Self, RollbackSweepError> {
        let database = database.trim();
        if !(database.starts_with("postgres://")
            || database.starts_with("postgresql://")
            || database.starts_with("host="))
        {
            return Err(RollbackSweepError::PostgreSqlRequired);
        }
        let connection = Connection::connect_postgres(database)?;
        crate::store::ensure_rollback_recovery_table(&connection)?;
        Ok(Self { connection })
    }

    pub fn inspect(
        &self,
        intent: &RollbackAuditIntent,
    ) -> Result<RollbackCoverage, RollbackSweepError> {
        match intent.rail.as_str() {
            "x402" => self.inspect_chain(intent),
            "pay_sh" => self.inspect_pay_sh(intent),
            "payout" => match audited_transaction_signature(intent)? {
                Some(signature) => self.inspect_payout(intent, &signature),
                None => Ok(RollbackCoverage::Mismatch(
                    "audit transaction signature does not match its signed bytes",
                )),
            },
            _ => Err(RollbackSweepError::UnsupportedIntent),
        }
    }

    pub fn inspect_model_call(
        &self,
        intent: &ModelCallAuditIntent,
    ) -> Result<RollbackCoverage, RollbackSweepError> {
        let row = self
            .connection
            .query_row(
                "SELECT scope_id, status FROM ai_generation_attempts
                 WHERE artifact_kind = ?1 AND input_hash = ?2
                   AND window_started_at = ?3",
                params![
                    intent.operation,
                    intent.input_hash,
                    i64::try_from(intent.window_started_at)
                        .map_err(|_| { RollbackSweepError::Incomplete("model budget window") })?,
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((scope_id, status)) = row else {
            return Ok(RollbackCoverage::Missing);
        };
        Ok(
            if format!("{:x}", Sha256::digest(scope_id.as_bytes())) == intent.scope_hash
                && matches!(status.as_str(), "started" | "completed" | "failed")
            {
                RollbackCoverage::Covered("model generation attempt")
            } else {
                RollbackCoverage::Mismatch("model generation scope or status")
            },
        )
    }

    pub fn install_window_hold(
        &self,
        recovery_id: &str,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<bool, RollbackSweepError> {
        if start_ms >= end_ms {
            return Err(RollbackSweepError::InvalidRecoveryIdentity);
        }
        let inserted = self.install_hold(RollbackHold {
            recovery_id,
            object_name: &format!("rollback-window/v1/{start_ms}-{end_ms}"),
            intent_kind: "window",
            rail: "recovery",
            operation: "rollback_window",
            event_id: recovery_id,
            audit_created_at: start_ms,
            reason: "external receipts must be reconciled before traffic resumes",
        })?;
        // The hold is durable before trigger repair begins. If a restore point
        // predates this feature or trigger installation fails halfway through,
        // current revisions remain blocked and the operator command fails.
        crate::store::install_rollback_recovery_guards(&self.connection)?;
        crate::store::ensure_chain_settlement_snapshot_columns(&self.connection)?;
        Ok(inserted)
    }

    pub fn install_payment_hold(
        &self,
        recovery_id: &str,
        object_name: &str,
        created_at_ms: u64,
        intent: &RollbackAuditIntent,
        reason: &str,
    ) -> Result<bool, RollbackSweepError> {
        self.install_hold(RollbackHold {
            recovery_id,
            object_name,
            intent_kind: "payment",
            rail: &intent.rail,
            operation: &intent.operation,
            event_id: &intent.event_id,
            audit_created_at: created_at_ms,
            reason,
        })
    }

    pub fn install_model_hold(
        &self,
        recovery_id: &str,
        object_name: &str,
        created_at_ms: u64,
        intent: &ModelCallAuditIntent,
        reason: &str,
    ) -> Result<bool, RollbackSweepError> {
        self.install_hold(RollbackHold {
            recovery_id,
            object_name,
            intent_kind: "model",
            rail: "vertex",
            operation: &intent.operation,
            event_id: &intent.input_hash,
            audit_created_at: created_at_ms,
            reason,
        })
    }

    pub fn resolve_recovery_holds(
        &mut self,
        recovery_id: &str,
        resolution_evidence: &str,
    ) -> Result<usize, RollbackSweepError> {
        validate_recovery_id(recovery_id)?;
        let resolution_evidence = resolution_evidence.trim();
        if !(8..=1_024).contains(&resolution_evidence.len())
            || resolution_evidence.chars().any(char::is_control)
        {
            return Err(RollbackSweepError::InvalidRecoveryIdentity);
        }
        let transaction = self.connection.transaction()?;
        let unresolved = transaction.query_row(
            "SELECT COUNT(*) FROM rollback_recovery_holds
             WHERE recovery_id = ?1 AND resolved_at IS NULL",
            [recovery_id],
            |row| row.get::<_, i64>(0),
        )?;
        if unresolved <= 0 {
            return Err(RollbackSweepError::NoUnresolvedHold);
        }
        let resolved = transaction.execute(
            "UPDATE rollback_recovery_holds
             SET resolved_at = ?1, resolution_evidence = ?2
             WHERE recovery_id = ?3 AND resolved_at IS NULL",
            params![as_i64(unix_time_ms())?, resolution_evidence, recovery_id],
        )?;
        if i64::try_from(resolved).ok() != Some(unresolved) {
            return Err(RollbackSweepError::HoldConflict);
        }
        transaction.commit()?;
        Ok(resolved)
    }

    fn install_hold(&self, hold: RollbackHold<'_>) -> Result<bool, RollbackSweepError> {
        validate_recovery_id(hold.recovery_id)?;
        if hold.object_name.is_empty()
            || hold.object_name.len() > 1_024
            || !matches!(hold.intent_kind, "window" | "payment" | "model")
            || hold.rail.is_empty()
            || hold.rail.len() > 64
            || hold.operation.is_empty()
            || hold.operation.len() > 64
            || hold.event_id.is_empty()
            || hold.event_id.len() > 512
            || hold.reason.is_empty()
            || hold.reason.len() > 512
            || hold
                .object_name
                .chars()
                .chain(hold.rail.chars())
                .chain(hold.operation.chars())
                .chain(hold.event_id.chars())
                .chain(hold.reason.chars())
                .any(char::is_control)
        {
            return Err(RollbackSweepError::InvalidRecoveryIdentity);
        }
        let hold_id = hold_id(hold.recovery_id, hold.object_name);
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO rollback_recovery_holds
             (hold_id, recovery_id, object_name, intent_kind, rail, operation,
              event_id, audit_created_at, reason, created_at, resolved_at,
              resolution_evidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL)",
            params![
                hold_id,
                hold.recovery_id,
                hold.object_name,
                hold.intent_kind,
                hold.rail,
                hold.operation,
                hold.event_id,
                as_i64(hold.audit_created_at)?,
                hold.reason,
                as_i64(unix_time_ms())?,
            ],
        )?;
        if inserted == 1 {
            return Ok(true);
        }
        let existing = self.connection.query_row(
            "SELECT recovery_id, object_name, intent_kind, rail, operation,
                    event_id, audit_created_at, reason
             FROM rollback_recovery_holds WHERE hold_id = ?1",
            [&hold_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )?;
        if existing
            == (
                hold.recovery_id.to_owned(),
                hold.object_name.to_owned(),
                hold.intent_kind.to_owned(),
                hold.rail.to_owned(),
                hold.operation.to_owned(),
                hold.event_id.to_owned(),
                as_i64(hold.audit_created_at)?,
                hold.reason.to_owned(),
            )
        {
            Ok(false)
        } else {
            Err(RollbackSweepError::HoldConflict)
        }
    }

    fn inspect_chain(
        &self,
        intent: &RollbackAuditIntent,
    ) -> Result<RollbackCoverage, RollbackSweepError> {
        let quote_id = required(intent.quote_id.as_deref(), "quote id")?;
        let (quote_table, amount_column, settlement_table) = match intent.operation.as_str() {
            "document" => ("payment_quotes", "amount_atomic", "chain_settlements"),
            "bundle" => (
                "payment_bundle_quotes",
                "deposit_atomic",
                "bundle_chain_settlements",
            ),
            "open_call" => (
                "open_call_funding_quotes",
                "amount_atomic",
                "open_call_chain_settlements",
            ),
            _ => return Err(RollbackSweepError::UnsupportedIntent),
        };
        let settled_sql = format!(
            "SELECT settlement.payer, settlement.pay_to, settlement.network,
                    quote.asset, settlement.amount_atomic,
                    settlement.transaction_signature,
                    settlement.prepared_transaction_base64
             FROM {settlement_table} settlement
             JOIN {quote_table} quote ON quote.id = settlement.quote_id
             WHERE settlement.quote_id = ?1"
        );
        let settlement = self
            .connection
            .query_row(&settled_sql, [quote_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?.to_string(),
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .optional()?;
        if let Some((payer, pay_to, network, asset, amount, signature, prepared)) = settlement {
            return Ok(
                if intent.payer.as_deref() == Some(payer.as_str())
                    && intent.recipient_wallet == pay_to
                    && intent.network == network
                    && intent.asset == asset
                    && intent.amount_atomic == amount
                    && prepared.as_deref() == Some(intent.signed_transaction_base64.as_str())
                    && intent
                        .transaction_signature
                        .as_deref()
                        .is_none_or(|expected| expected == signature)
                {
                    RollbackCoverage::Covered("settlement")
                } else {
                    RollbackCoverage::Mismatch("settlement evidence or economics")
                },
            );
        }

        let attempt_sql = format!(
            "SELECT attempt.payer_wallet, attempt.signed_transaction_base64,
                    attempt.recent_blockhash, quote.pay_to, quote.network,
                    quote.asset, quote.{amount_column}
             FROM chain_payment_attempts attempt
             JOIN {quote_table} quote ON quote.id = attempt.quote_id
             WHERE attempt.attempt_id = ?1 AND attempt.settlement_kind = ?2
               AND attempt.quote_id = ?3"
        );
        let attempt = self
            .connection
            .query_row(
                &attempt_sql,
                params![intent.event_id, intent.operation, quote_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?.to_string(),
                    ))
                },
            )
            .optional()?;
        let Some((payer, signed, blockhash, pay_to, network, asset, amount)) = attempt else {
            return Ok(RollbackCoverage::Missing);
        };
        Ok(
            if payer == intent.payer
                && signed.as_deref() == Some(intent.signed_transaction_base64.as_str())
                && blockhash.as_deref() == Some(intent.recent_blockhash.as_str())
                && pay_to == intent.recipient_wallet
                && network == intent.network
                && asset == intent.asset
                && amount == intent.amount_atomic
            {
                RollbackCoverage::Covered("attempt")
            } else {
                RollbackCoverage::Mismatch("attempt evidence or economics")
            },
        )
    }

    fn inspect_pay_sh(
        &self,
        intent: &RollbackAuditIntent,
    ) -> Result<RollbackCoverage, RollbackSweepError> {
        let quote_id = required(intent.quote_id.as_deref(), "quote id")?;
        let (table, job_column) = match intent.operation.as_str() {
            "direct_document" => ("direct_pay_sh_attempts", "CAST(NULL AS TEXT)"),
            "research_document" => {
                required(intent.job_id.as_deref(), "research job id")?;
                ("research_payment_attempts", "attempt.job_id")
            }
            _ => return Err(RollbackSweepError::UnsupportedIntent),
        };
        let sql = format!(
            "SELECT attempt.quote_id, {job_column}, attempt.payer_wallet,
                    attempt.signed_transaction_base64, attempt.recent_blockhash,
                    attempt.challenge_id, attempt.external_id,
                    attempt.challenge_expires_at, attempt.platform_recipient_wallet,
                    quote.pay_to, quote.network, quote.asset, quote.amount_atomic
             FROM {table} attempt
             JOIN payment_quotes quote ON quote.id = attempt.quote_id
             WHERE attempt.attempt_id = ?1"
        );
        let row = self
            .connection
            .query_row(&sql, [intent.event_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, i64>(12)?.to_string(),
                ))
            })
            .optional()?;
        let Some((
            stored_quote,
            stored_job,
            payer,
            signed,
            blockhash,
            challenge,
            external,
            challenge_expiry,
            platform_recipient,
            pay_to,
            network,
            asset,
            amount,
        )) = row
        else {
            return Ok(RollbackCoverage::Missing);
        };
        Ok(
            if stored_quote == quote_id
                && stored_job == intent.job_id
                && payer == intent.payer
                && signed.as_deref() == Some(intent.signed_transaction_base64.as_str())
                && blockhash.as_deref() == Some(intent.recent_blockhash.as_str())
                && challenge == intent.challenge_id
                && external == intent.external_id
                && challenge_expiry.and_then(|value| u64::try_from(value).ok())
                    == intent.challenge_expires_at
                && platform_recipient == intent.platform_recipient_wallet
                && pay_to == intent.recipient_wallet
                && network == intent.network
                && asset == intent.asset
                && amount == intent.amount_atomic
            {
                RollbackCoverage::Covered("attempt")
            } else {
                RollbackCoverage::Mismatch("Pay.sh attempt evidence or economics")
            },
        )
    }

    fn inspect_payout(
        &self,
        intent: &RollbackAuditIntent,
        expected_transaction_signature: &str,
    ) -> Result<RollbackCoverage, RollbackSweepError> {
        let signature = required(
            intent.transaction_signature.as_deref(),
            "payout transaction signature",
        )?;
        if signature != expected_transaction_signature {
            return Ok(RollbackCoverage::Mismatch(
                "payout audit signature does not match its signed bytes",
            ));
        }
        let suffix = format!(":{signature}");
        let claim_id = intent
            .event_id
            .strip_suffix(&suffix)
            .filter(|value| !value.is_empty())
            .ok_or(RollbackSweepError::Incomplete("payout claim id"))?;
        let row = self
            .connection
            .query_row(
                "SELECT kind, escrow_wallet, recipient_wallet, asset, network,
                        amount_atomic, transaction_signature,
                        signed_transaction_base64, recent_blockhash,
                        last_valid_block_height
                 FROM payout_claims WHERE id = ?1",
                [claim_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?.to_string(),
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<i64>>(9)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            kind,
            escrow,
            recipient,
            asset,
            network,
            amount,
            stored_signature,
            signed,
            blockhash,
            last_valid_height,
        )) = row
        else {
            return Ok(RollbackCoverage::Missing);
        };
        Ok(
            if kind == intent.operation
                && intent.payer.as_deref() == Some(escrow.as_str())
                && recipient == intent.recipient_wallet
                && asset == intent.asset
                && network == intent.network
                && amount == intent.amount_atomic
                && stored_signature.as_deref() == Some(signature)
                && signed.as_deref() == Some(intent.signed_transaction_base64.as_str())
                && blockhash.as_deref() == Some(intent.recent_blockhash.as_str())
                && last_valid_height.and_then(|value| u64::try_from(value).ok())
                    == intent.last_valid_block_height
            {
                RollbackCoverage::Covered("payout claim")
            } else {
                RollbackCoverage::Mismatch("payout evidence or economics")
            },
        )
    }

    #[cfg(test)]
    fn from_connection(connection: Connection) -> Self {
        Self { connection }
    }
}

struct RollbackHold<'a> {
    recovery_id: &'a str,
    object_name: &'a str,
    intent_kind: &'a str,
    rail: &'a str,
    operation: &'a str,
    event_id: &'a str,
    audit_created_at: u64,
    reason: &'a str,
}

fn validate_recovery_id(recovery_id: &str) -> Result<(), RollbackSweepError> {
    if !(8..=128).contains(&recovery_id.len())
        || !recovery_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(RollbackSweepError::InvalidRecoveryIdentity);
    }
    Ok(())
}

fn hold_id(recovery_id: &str, object_name: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(recovery_id.as_bytes());
    digest.update([0]);
    digest.update(object_name.as_bytes());
    format!("{:x}", digest.finalize())
}

fn as_i64(value: u64) -> Result<i64, RollbackSweepError> {
    i64::try_from(value).map_err(|_| RollbackSweepError::InvalidRecoveryIdentity)
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn required<'a>(value: Option<&'a str>, name: &'static str) -> Result<&'a str, RollbackSweepError> {
    value
        .filter(|value| !value.is_empty())
        .ok_or(RollbackSweepError::Incomplete(name))
}

fn audited_transaction_signature(
    intent: &RollbackAuditIntent,
) -> Result<Option<String>, RollbackSweepError> {
    let bytes = BASE64_STANDARD
        .decode(&intent.signed_transaction_base64)
        .map_err(|_| RollbackSweepError::Incomplete("signed transaction"))?;
    let derived = fully_signed_solana_transaction_signature(&bytes)
        .ok_or(RollbackSweepError::Incomplete("transaction signature"))?;
    Ok(match intent.transaction_signature.as_deref() {
        Some(stored) if stored != derived => None,
        _ => Some(derived),
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
    use rand_core::{OsRng, RngCore};
    use sha2::{Digest, Sha256};

    use crate::{
        db::Connection,
        domain::{
            BindPayShChallengesRequest, ClaimPaymentAttemptRequest, PayShChallengeBindingRequest,
            PrepareDirectPayShPaymentRequest, RecordChainSettlementRequest, ResolveQuestionRequest,
            SearchFilters,
        },
        rollback_audit::{ModelCallAuditIntent, RollbackAuditIntent},
        search::Resolver,
        store::{PaymentQuotePolicy, Store, StoreError},
    };

    use super::{RollbackCoverage, RollbackSweepLedger};

    struct TestDatabase(PathBuf);

    impl TestDatabase {
        fn new() -> Self {
            let mut nonce = [0_u8; 16];
            OsRng.fill_bytes(&mut nonce);
            Self(std::env::temp_dir().join(format!("openshelf-rollback-sweep-{}.db", hex(&nonce))))
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            for path in [
                self.0.clone(),
                PathBuf::from(format!("{}-wal", self.0.display())),
                PathBuf::from(format!("{}-shm", self.0.display())),
            ] {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn prepared_x402_transaction(signature_byte: u8) -> Vec<u8> {
        let mut transaction = vec![42_u8; 180];
        transaction[0] = 2;
        transaction[1..65].fill(0);
        transaction[65..129].fill(signature_byte);
        transaction
    }

    #[test]
    fn restored_ledger_sweep_finds_an_attempt_erased_after_external_permission() {
        let database = TestDatabase::new();
        let store = Store::open(&database.0).unwrap();
        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Where do Seongsu residents eat lunch when the queue is long?".to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution(&resolved.query_id, &resolved, Some(&"a".repeat(64)))
            .unwrap();
        let policy = PaymentQuotePolicy {
            fallback_recipient: Some("11111111111111111111111111111111".to_owned()),
            bundle_recipient: Some("11111111111111111111111111111111".to_owned()),
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };
        let quote = store
            .x402_payment_quote(&resolved.query_id, &resolved.matches[0].handle, &policy)
            .unwrap();
        let chain_transaction = prepared_x402_transaction(23);
        let signed = BASE64_STANDARD.encode(chain_transaction);
        let attempt_id = hex(&Sha256::digest(signed.as_bytes()));
        let chain_quote_id = quote.id.clone();
        store
            .claim_payment_attempt(&ClaimPaymentAttemptRequest {
                settlement_kind: "document".to_owned(),
                quote_id: chain_quote_id.clone(),
                attempt_id: attempt_id.clone(),
                payer: Some("SysvarRent111111111111111111111111111111111".to_owned()),
                signed_transaction_base64: Some(signed),
                recent_blockhash: Some("11111111111111111111111111111111".to_owned()),
                absence_observed: false,
            })
            .unwrap();
        let intent =
            RollbackAuditIntent::chain(&store.payment_attempt_reconciliation(&attempt_id).unwrap())
                .unwrap();
        store
            .record_chain_settlement(&RecordChainSettlementRequest {
                quote_id: chain_quote_id.clone(),
                attempt_id: Some(attempt_id.clone()),
                transaction_signature: bs58::encode([23_u8; 64]).into_string(),
                payer: "SysvarRent111111111111111111111111111111111".to_owned(),
                pay_to: quote.pay_to,
                amount_atomic: quote.amount_atomic,
                network: quote.network,
                raw_response: serde_json::json!({"success": true}),
            })
            .unwrap();

        let pay_sh_resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Where do Seongsu residents eat lunch when the queue is long?".to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        let payment_token_hash = "b".repeat(64);
        store
            .record_resolution(
                "Where do Seongsu residents eat lunch when the queue is long?",
                &pay_sh_resolved,
                Some(&payment_token_hash),
            )
            .unwrap();
        let resource = store
            .pay_sh_resource(
                &pay_sh_resolved.query_id,
                &pay_sh_resolved.matches[0].handle,
                &payment_token_hash,
                &policy,
            )
            .unwrap();
        let mut pay_sh_bytes = vec![7_u8; 192];
        pay_sh_bytes[0] = 2;
        let pay_sh_attempt_id = hex(&Sha256::digest(&pay_sh_bytes));
        let challenge_id = "restore-direct-challenge";
        let external_id = format!("human-document-krw-{}#restore", resource.price_krw);
        let challenge_expires_at = unix_time_ms() + 60_000;
        store
            .bind_pay_sh_challenges(
                &BindPayShChallengesRequest {
                    quote_id: resource.quote_id.clone(),
                    query_id: resource.query_id.clone(),
                    document_handle: resource.document_handle.clone(),
                    path_price_krw: resource.price_krw,
                    owner_wallet: resource.recipient_wallet.clone(),
                    research_job_id: None,
                    payment_attempt_id: None,
                    challenges: vec![PayShChallengeBindingRequest {
                        challenge_id: challenge_id.to_owned(),
                        external_id: external_id.clone(),
                        challenge_expires_at,
                    }],
                },
                Some(&payment_token_hash),
            )
            .unwrap();
        let direct = store
            .prepare_direct_pay_sh_payment(
                &pay_sh_attempt_id,
                &PrepareDirectPayShPaymentRequest {
                    quote_id: resource.quote_id.clone(),
                    query_id: resource.query_id,
                    document_handle: resource.document_handle,
                    path_price_krw: resource.price_krw,
                    owner_wallet: resource.recipient_wallet.clone(),
                    payer: resource.recipient_wallet.clone(),
                    platform_recipient_wallet: resource.recipient_wallet,
                    challenge_id: challenge_id.to_owned(),
                    external_id,
                    signed_transaction_base64: BASE64_STANDARD.encode(pay_sh_bytes),
                    recent_blockhash: "11111111111111111111111111111111".to_owned(),
                    challenge_expires_at,
                },
                &payment_token_hash,
            )
            .unwrap();
        let direct_intent = RollbackAuditIntent::direct(&direct);

        let payout_claim_id = "rollback-sweep-payout";
        let payout_network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
        let payout_asset = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        let payout_setup = Connection::open(&database.0).unwrap();
        payout_setup
            .execute(
                "INSERT INTO payout_claims
                 (id, beneficiary_user_id, kind, escrow_wallet, recipient_wallet,
                  asset, network, amount_atomic, amount_krw, status, created_at, updated_at)
                 VALUES (?1, 'restore-beneficiary', 'restore-refund', ?2, ?3,
                         ?4, ?5, 77, 0, 'pending', ?6, ?6)",
                crate::params![
                    payout_claim_id,
                    "11111111111111111111111111111111",
                    "SysvarRent111111111111111111111111111111111",
                    payout_asset,
                    payout_network,
                    unix_time_ms() as i64,
                ],
            )
            .unwrap();
        drop(payout_setup);
        store
            .lease_payout_claims(
                "restore-sweep-worker",
                "11111111111111111111111111111111",
                payout_network,
                1,
                60_000,
            )
            .unwrap();
        let payout_signature = bs58::encode([32_u8; 64]).into_string();
        let mut payout_transaction = [32_u8; 180];
        payout_transaction[0] = 1;
        let payout = store
            .prepare_payout_claim(
                payout_claim_id,
                "restore-sweep-worker",
                &payout_signature,
                &BASE64_STANDARD.encode(payout_transaction),
                &bs58::encode([33_u8; 32]).into_string(),
                991,
            )
            .unwrap();
        let payout_intent = RollbackAuditIntent::payout(&payout).unwrap();
        let model_input = "c".repeat(64);
        let model_window = match store
            .claim_ai_generation("baseline", "restore-model-scope", &model_input, &[])
            .unwrap()
        {
            crate::store::AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            _ => panic!("model rollback fixture should acquire its exact input"),
        };
        let model_intent = ModelCallAuditIntent::new(
            "baseline",
            "restore-model-scope",
            &model_input,
            model_window,
            "general-liquidity-v1:vertex:test-model",
        )
        .unwrap();

        // Two operations are already fenced when the restore sweep begins.
        // They represent external requests that may be in flight and therefore
        // must remain completable while the hold blocks all new purchases.
        let recovery_resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Which Seongsu lunch counter still works during a network partition?"
                    .to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution(&recovery_resolved.query_id, &recovery_resolved, None)
            .unwrap();
        let recovery_quote = store
            .x402_payment_quote(
                &recovery_resolved.query_id,
                &recovery_resolved.matches[0].handle,
                &policy,
            )
            .unwrap();
        let recovery_transaction = prepared_x402_transaction(41);
        let recovery_signed = BASE64_STANDARD.encode(recovery_transaction);
        let recovery_attempt_id = hex(&Sha256::digest(recovery_signed.as_bytes()));
        store
            .claim_payment_attempt(&ClaimPaymentAttemptRequest {
                settlement_kind: "document".to_owned(),
                quote_id: recovery_quote.id.clone(),
                attempt_id: recovery_attempt_id.clone(),
                payer: Some("SysvarRent111111111111111111111111111111111".to_owned()),
                signed_transaction_base64: Some(recovery_signed),
                recent_blockhash: Some("11111111111111111111111111111111".to_owned()),
                absence_observed: false,
            })
            .unwrap();
        let recovery_model_input = "d".repeat(64);
        let recovery_model_window = match store
            .claim_ai_generation(
                "baseline",
                "restore-model-already-in-flight",
                &recovery_model_input,
                &[],
            )
            .unwrap()
        {
            crate::store::AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            _ => panic!("in-flight model fixture should acquire its exact input"),
        };

        // This quote exists before the sweep but has not crossed an external
        // side-effect boundary. Both current and stale revisions must be unable
        // to turn it into a payment attempt while the restored DB is held.
        let blocked_resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Which Seongsu lunch counter survives a stale Cloud Run revision?"
                    .to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution(&blocked_resolved.query_id, &blocked_resolved, None)
            .unwrap();
        let blocked_quote = store
            .x402_payment_quote(
                &blocked_resolved.query_id,
                &blocked_resolved.matches[0].handle,
                &policy,
            )
            .unwrap();
        let blocked_transaction = prepared_x402_transaction(43);
        let blocked_signed = BASE64_STANDARD.encode(blocked_transaction);
        let blocked_attempt_id = hex(&Sha256::digest(blocked_signed.as_bytes()));
        let blocked_request = ClaimPaymentAttemptRequest {
            settlement_kind: "document".to_owned(),
            quote_id: blocked_quote.id.clone(),
            attempt_id: blocked_attempt_id.clone(),
            payer: Some("SysvarRent111111111111111111111111111111111".to_owned()),
            signed_transaction_base64: Some(blocked_signed.clone()),
            recent_blockhash: Some("11111111111111111111111111111111".to_owned()),
            absence_observed: false,
        };

        let mut ledger =
            RollbackSweepLedger::from_connection(Connection::open(&database.0).unwrap());
        assert_eq!(
            ledger.inspect(&intent).unwrap(),
            RollbackCoverage::Covered("settlement")
        );
        let mut wrong_chain_intent = intent.clone();
        wrong_chain_intent.signed_transaction_base64 =
            BASE64_STANDARD.encode(prepared_x402_transaction(24));
        assert_eq!(
            ledger.inspect(&wrong_chain_intent).unwrap(),
            RollbackCoverage::Mismatch("settlement evidence or economics"),
            "same quote, amount, payer, and callback signature cannot cover a different prepared x402 transaction"
        );
        assert_eq!(
            ledger.inspect(&direct_intent).unwrap(),
            RollbackCoverage::Covered("attempt")
        );
        let mut wrong_direct_intent = direct_intent.clone();
        wrong_direct_intent.signed_transaction_base64 = BASE64_STANDARD.encode([25_u8; 192]);
        assert_eq!(
            ledger.inspect(&wrong_direct_intent).unwrap(),
            RollbackCoverage::Mismatch("Pay.sh attempt evidence or economics"),
            "matching Pay.sh economics cannot cover a different prepared credential"
        );
        assert_eq!(
            ledger.inspect(&payout_intent).unwrap(),
            RollbackCoverage::Covered("payout claim")
        );
        assert_eq!(
            ledger.inspect_model_call(&model_intent).unwrap(),
            RollbackCoverage::Covered("model generation attempt")
        );
        // A physical PITR restore can remove a row without executing its SQL
        // DELETE trigger. Disable only the test copy's immutability guards so
        // the fixture can reproduce that storage-level history loss.
        ledger
            .connection
            .execute_batch(
                "DROP TRIGGER guard_chain_settlements_immutable;
                 DROP TRIGGER guard_chain_settlements_immutable_delete;",
            )
            .unwrap();
        ledger
            .connection
            .execute(
                "DELETE FROM chain_settlements WHERE quote_id = ?1",
                [&chain_quote_id],
            )
            .unwrap();
        assert_eq!(
            ledger.inspect(&intent).unwrap(),
            RollbackCoverage::Missing,
            "a restore before prepare must not look healthy merely because its quote survived"
        );
        ledger
            .connection
            .execute(
                "UPDATE payment_quotes SET amount_atomic = amount_atomic + 1 WHERE id = ?1",
                [&resource.quote_id],
            )
            .unwrap();
        assert_eq!(
            ledger.inspect(&direct_intent).unwrap(),
            RollbackCoverage::Mismatch("Pay.sh attempt evidence or economics")
        );
        ledger
            .connection
            .execute("DELETE FROM payout_claims WHERE id = ?1", [payout_claim_id])
            .unwrap();
        assert_eq!(
            ledger.inspect(&payout_intent).unwrap(),
            RollbackCoverage::Missing
        );
        ledger
            .connection
            .execute(
                "DELETE FROM ai_generation_attempts WHERE input_hash = ?1",
                [&model_input],
            )
            .unwrap();
        assert_eq!(
            ledger.inspect_model_call(&model_intent).unwrap(),
            RollbackCoverage::Missing
        );

        let recovery_id = "cloud-sql-restore-20260808-a";
        let end_ms = unix_time_ms();
        assert!(
            ledger
                .install_window_hold(recovery_id, end_ms - 60_000, end_ms)
                .unwrap()
        );
        assert!(
            ledger
                .install_payment_hold(
                    recovery_id,
                    "intents/v1/x402/erased.json",
                    end_ms - 30_000,
                    &intent,
                    "no exact attempt, settlement, or payout claim",
                )
                .unwrap()
        );
        assert!(
            ledger
                .install_payment_hold(
                    recovery_id,
                    "intents/v1/pay_sh/mismatch.json",
                    end_ms - 20_000,
                    &direct_intent,
                    "Pay.sh attempt evidence or economics",
                )
                .unwrap()
        );
        assert!(
            ledger
                .install_payment_hold(
                    recovery_id,
                    "intents/v1/payout/erased.json",
                    end_ms - 10_000,
                    &payout_intent,
                    "no exact attempt, settlement, or payout claim",
                )
                .unwrap()
        );
        assert!(
            ledger
                .install_model_hold(
                    recovery_id,
                    "provider-intents/v1/baseline/erased.json",
                    end_ms - 5_000,
                    &model_intent,
                    "no exact model generation attempt",
                )
                .unwrap()
        );
        assert!(
            !ledger
                .install_window_hold(recovery_id, end_ms - 60_000, end_ms)
                .unwrap(),
            "a killed and restarted sweep must converge on the same hold"
        );
        assert!(matches!(store.ready(), Err(StoreError::Conflict(_))));
        assert!(matches!(
            store.claim_payment_attempt(&blocked_request),
            Err(StoreError::Conflict(message)) if message.contains("rollback recovery")
        ));

        let stale_revision = Connection::open(&database.0).unwrap();
        let stale_error = stale_revision
            .execute(
                "INSERT INTO chain_payment_attempts
                 (settlement_kind, quote_id, attempt_id, payer_wallet,
                  signed_transaction_base64, recent_blockhash, reconcile_after, created_at)
                 VALUES ('document', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                crate::params![
                    blocked_quote.id,
                    blocked_attempt_id,
                    "SysvarRent111111111111111111111111111111111",
                    blocked_signed,
                    "11111111111111111111111111111111",
                    (end_ms + 60_000) as i64,
                    end_ms as i64,
                ],
            )
            .unwrap_err();
        assert!(
            stale_error
                .to_string()
                .contains("rollback recovery blocks new external side effects"),
            "the restored database itself must stop a revision with no hold-aware code: {stale_error}"
        );

        store
            .record_chain_settlement(&RecordChainSettlementRequest {
                quote_id: recovery_quote.id,
                attempt_id: Some(recovery_attempt_id),
                transaction_signature: bs58::encode([41_u8; 64]).into_string(),
                payer: "SysvarRent111111111111111111111111111111111".to_owned(),
                pay_to: recovery_quote.pay_to,
                amount_atomic: recovery_quote.amount_atomic,
                network: recovery_quote.network,
                raw_response: serde_json::json!({"success": true}),
            })
            .unwrap();
        store
            .complete_ai_generation(
                "baseline",
                "restore-model-already-in-flight",
                &recovery_model_input,
                recovery_model_window,
                None,
            )
            .unwrap();

        assert_eq!(
            ledger
                .resolve_recovery_holds(
                    recovery_id,
                    "incident://INC-2048/external-receipts-reviewed"
                )
                .unwrap(),
            5
        );
        store
            .claim_payment_attempt(&blocked_request)
            .expect("a reconciled and explicitly resolved incident may authorize new work again");
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn unix_time_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
}
