use std::{collections::HashSet, sync::Arc, time::Duration};

#[cfg(test)]
use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use google_cloud_auth::credentials::{AccessTokenCredentials, Builder as CredentialsBuilder};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::domain::{
    ClaimPaymentAttemptRequest, DirectPayShPaymentReconciliation, PaymentAttemptReconciliation,
    PayoutClaim, ResearchPaymentReconciliation,
};
use crate::store::{fully_signed_solana_transaction_signature, valid_x402_prepared_transaction};

const MAX_AUDIT_OBJECT_BYTES: usize = 16 * 1_024;
const MAX_GCS_LIST_RESPONSE_BYTES: usize = 2 * 1_024 * 1_024;
const MAX_GCS_LIST_PAGES: usize = 4_096;
const MAX_SWEEP_MATCHING_OBJECTS: usize = 100_000;
const MAX_SWEEP_WINDOW_MS: u64 = 31 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Error)]
pub enum RollbackAuditError {
    #[error("rollback audit configuration is invalid: {0}")]
    Configuration(String),
    #[error("rollback audit credentials are unavailable: {0}")]
    Credentials(String),
    #[error("rollback audit transport failed: {0}")]
    Transport(String),
    #[error("rollback audit object conflicts with a different payment intent")]
    Conflict,
    #[error("rollback audit intent is incomplete: {0}")]
    Incomplete(&'static str),
    #[error(
        "rollback audit sweep exceeded the {0} safety bound; keep traffic stopped and use smaller incident windows"
    )]
    SweepLimit(&'static str),
}

#[derive(Clone)]
pub struct RollbackAudit {
    backend: Arc<RollbackAuditBackend>,
}

enum RollbackAuditBackend {
    Disabled,
    Gcs(GcsRollbackAudit),
    #[cfg(test)]
    Memory(MemoryRollbackAudit),
}

struct GcsRollbackAudit {
    bucket: String,
    object_prefix: String,
    client: Client,
    credentials: AccessTokenCredentials,
}

#[cfg(test)]
struct MemoryRollbackAudit {
    objects: std::sync::Mutex<HashMap<String, Vec<u8>>>,
    fail_writes: std::sync::atomic::AtomicBool,
}

/// The intentionally timestamp-free, canonical economic intent written before
/// any managed component is allowed to invoke an external money-moving API.
/// GCS `timeCreated` supplies an independent wall-clock for PITR comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RollbackAuditIntent {
    pub(crate) version: u8,
    pub(crate) rail: String,
    pub(crate) operation: String,
    pub(crate) event_id: String,
    pub(crate) quote_id: Option<String>,
    pub(crate) job_id: Option<String>,
    pub(crate) network: String,
    pub(crate) asset: String,
    pub(crate) amount_atomic: String,
    pub(crate) payer: Option<String>,
    pub(crate) recipient_wallet: String,
    pub(crate) platform_recipient_wallet: Option<String>,
    pub(crate) owner_amount_atomic: Option<String>,
    pub(crate) platform_amount_atomic: Option<String>,
    pub(crate) signed_transaction_base64: String,
    pub(crate) recent_blockhash: String,
    pub(crate) challenge_id: Option<String>,
    pub(crate) external_id: Option<String>,
    pub(crate) challenge_expires_at: Option<u64>,
    pub(crate) transaction_signature: Option<String>,
    pub(crate) last_valid_block_height: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct RollbackAuditRecord {
    pub object_name: String,
    pub created_at_ms: u64,
    pub intent: RollbackAuditIntent,
}

/// Privacy-minimized proof that one externally billed model request was
/// authorized. The prompt, evidence, profile, and provider response never leave
/// the application database through this record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCallAuditIntent {
    pub(crate) version: u8,
    pub(crate) operation: String,
    pub(crate) scope_hash: String,
    pub(crate) input_hash: String,
    pub(crate) window_started_at: u64,
    pub(crate) provider_fence: String,
}

#[derive(Debug, Clone)]
pub struct ModelCallAuditRecord {
    pub object_name: String,
    pub created_at_ms: u64,
    pub intent: ModelCallAuditIntent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GcsObjectList {
    #[serde(default)]
    items: Vec<GcsObjectMetadata>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GcsObjectMetadata {
    name: String,
    time_created: String,
    temporary_hold: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GcsObjectWriteMetadata {
    name: String,
    temporary_hold: bool,
}

impl RollbackAuditIntent {
    pub fn validate_chain_request(
        value: &ClaimPaymentAttemptRequest,
    ) -> Result<(), RollbackAuditError> {
        required(value.payer.as_deref(), "x402 payer")?;
        required(value.recent_blockhash.as_deref(), "x402 recent blockhash")?;
        let signed_transaction = required(
            value.signed_transaction_base64.as_deref(),
            "x402 signed transaction",
        )?;
        x402_prepared_transaction(&signed_transaction)?;
        Ok(())
    }

    pub fn rail(&self) -> &str {
        &self.rail
    }

    pub fn operation(&self) -> &str {
        &self.operation
    }

    pub fn event_id(&self) -> &str {
        &self.event_id
    }

    pub fn quote_id(&self) -> Option<&str> {
        self.quote_id.as_deref()
    }

    pub fn job_id(&self) -> Option<&str> {
        self.job_id.as_deref()
    }

    pub fn chain(value: &PaymentAttemptReconciliation) -> Result<Self, RollbackAuditError> {
        let signed_transaction_base64 = required(
            value.signed_transaction_base64.as_deref(),
            "x402 signed transaction",
        )?;
        x402_prepared_transaction(&signed_transaction_base64)?;
        Ok(Self {
            version: 3,
            rail: "x402".to_owned(),
            operation: value.settlement_kind.clone(),
            event_id: value.attempt_id.clone(),
            quote_id: Some(value.quote_id.clone()),
            job_id: None,
            network: value.network.clone(),
            asset: value.asset.clone(),
            amount_atomic: value.amount_atomic.clone(),
            payer: value.payer.clone(),
            recipient_wallet: value.pay_to.clone(),
            platform_recipient_wallet: None,
            owner_amount_atomic: None,
            platform_amount_atomic: None,
            signed_transaction_base64: signed_transaction_base64.clone(),
            recent_blockhash: required(value.recent_blockhash.as_deref(), "x402 recent blockhash")?,
            challenge_id: None,
            external_id: None,
            challenge_expires_at: None,
            // The x402 facilitator adds the fee-payer signature only after
            // this pre-transport audit. The exact partial payload is the
            // immutable authorization evidence; the final signature cannot
            // honestly be predicted here.
            transaction_signature: None,
            last_valid_block_height: None,
        })
    }

    pub fn research(value: &ResearchPaymentReconciliation) -> Result<Self, RollbackAuditError> {
        let signed_transaction_base64 = required(
            value.signed_transaction_base64.as_deref(),
            "research signed transaction",
        )?;
        Ok(Self {
            version: 2,
            rail: "pay_sh".to_owned(),
            operation: "research_document".to_owned(),
            event_id: value.attempt_id.clone(),
            quote_id: Some(value.quote_id.clone()),
            job_id: Some(value.job_id.clone()),
            network: value.network.clone(),
            asset: value.asset.clone(),
            amount_atomic: value.amount_atomic.clone(),
            payer: Some(value.payer.clone()),
            recipient_wallet: value.recipient_wallet.clone(),
            platform_recipient_wallet: value.platform_recipient_wallet.clone(),
            owner_amount_atomic: Some(value.owner_amount_atomic.clone()),
            platform_amount_atomic: Some(value.platform_amount_atomic.clone()),
            signed_transaction_base64: signed_transaction_base64.clone(),
            recent_blockhash: required(
                value.recent_blockhash.as_deref(),
                "research recent blockhash",
            )?,
            challenge_id: Some(required(
                value.challenge_id.as_deref(),
                "research challenge id",
            )?),
            external_id: Some(required(
                value.external_id.as_deref(),
                "research external id",
            )?),
            challenge_expires_at: Some(
                value
                    .challenge_expires_at
                    .ok_or(RollbackAuditError::Incomplete("research challenge expiry"))?,
            ),
            // Pay.sh can add its fee-payer signature after this durable
            // pre-transport credential is recorded.
            transaction_signature: None,
            last_valid_block_height: None,
        })
    }

    pub fn direct(value: &DirectPayShPaymentReconciliation) -> Self {
        Self {
            version: 2,
            rail: "pay_sh".to_owned(),
            operation: "direct_document".to_owned(),
            event_id: value.attempt_id.clone(),
            quote_id: Some(value.quote_id.clone()),
            job_id: None,
            network: value.network.clone(),
            asset: value.asset.clone(),
            amount_atomic: value.amount_atomic.clone(),
            payer: Some(value.payer.clone()),
            recipient_wallet: value.recipient_wallet.clone(),
            platform_recipient_wallet: value.platform_recipient_wallet.clone(),
            owner_amount_atomic: Some(value.owner_amount_atomic.clone()),
            platform_amount_atomic: Some(value.platform_amount_atomic.clone()),
            signed_transaction_base64: value.signed_transaction_base64.clone(),
            recent_blockhash: value.recent_blockhash.clone(),
            challenge_id: Some(value.challenge_id.clone()),
            external_id: Some(value.external_id.clone()),
            challenge_expires_at: Some(value.challenge_expires_at),
            transaction_signature: None,
            last_valid_block_height: None,
        }
    }

    pub fn payout(value: &PayoutClaim) -> Result<Self, RollbackAuditError> {
        let expected_transaction_signature = required(
            value.transaction_signature.as_deref(),
            "payout transaction signature",
        )?;
        let signed_transaction_base64 = required(
            value.signed_transaction_base64.as_deref(),
            "payout signed transaction",
        )?;
        if transaction_signature(
            &signed_transaction_base64,
            "payout signed transaction signature",
        )? != expected_transaction_signature
        {
            return Err(RollbackAuditError::Incomplete(
                "payout signed transaction signature",
            ));
        }
        Ok(Self {
            version: 2,
            rail: "payout".to_owned(),
            operation: value.kind.clone(),
            // A claim may legitimately be re-signed after two independent
            // absence proofs and blockhash expiry. Each exact transaction is
            // therefore its own immutable external-side-effect intent.
            event_id: format!("{}:{expected_transaction_signature}", value.id),
            quote_id: None,
            job_id: None,
            network: value.network.clone(),
            asset: value.asset.clone(),
            amount_atomic: value.amount_atomic.clone(),
            payer: Some(value.escrow_wallet.clone()),
            recipient_wallet: value.recipient_wallet.clone(),
            platform_recipient_wallet: None,
            owner_amount_atomic: None,
            platform_amount_atomic: None,
            signed_transaction_base64,
            recent_blockhash: required(
                value.recent_blockhash.as_deref(),
                "payout recent blockhash",
            )?,
            challenge_id: None,
            external_id: None,
            challenge_expires_at: None,
            transaction_signature: Some(expected_transaction_signature),
            last_valid_block_height: Some(value.last_valid_block_height.ok_or(
                RollbackAuditError::Incomplete("payout last valid block height"),
            )?),
        })
    }

    fn object_name(&self) -> String {
        let digest = Sha256::digest(self.event_id.as_bytes());
        format!("intents/v{}/{}/{digest:x}.json", self.version, self.rail)
    }
}

fn transaction_signature(
    signed_transaction_base64: &str,
    name: &'static str,
) -> Result<String, RollbackAuditError> {
    let transaction = BASE64_STANDARD
        .decode(signed_transaction_base64)
        .map_err(|_| RollbackAuditError::Incomplete(name))?;
    fully_signed_solana_transaction_signature(&transaction)
        .ok_or(RollbackAuditError::Incomplete(name))
}

fn x402_prepared_transaction(signed_transaction_base64: &str) -> Result<(), RollbackAuditError> {
    let transaction = BASE64_STANDARD
        .decode(signed_transaction_base64)
        .map_err(|_| RollbackAuditError::Incomplete("x402 prepared transaction"))?;
    if !(100..=2_048).contains(&transaction.len()) || !valid_x402_prepared_transaction(&transaction)
    {
        return Err(RollbackAuditError::Incomplete("x402 prepared transaction"));
    }
    Ok(())
}

impl ModelCallAuditIntent {
    pub fn new(
        operation: &str,
        scope_id: &str,
        input_hash: &str,
        window_started_at: u64,
        provider_fence: &str,
    ) -> Result<Self, RollbackAuditError> {
        if !matches!(operation, "baseline" | "shelf_starters" | "synthesis")
            || scope_id.is_empty()
            || scope_id.chars().count() > 200
            || input_hash.len() != 64
            || !input_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || provider_fence.is_empty()
            || provider_fence.len() > 256
        {
            return Err(RollbackAuditError::Incomplete("model call identity"));
        }
        Ok(Self {
            version: 1,
            operation: operation.to_owned(),
            scope_hash: format!("{:x}", Sha256::digest(scope_id.as_bytes())),
            input_hash: input_hash.to_owned(),
            window_started_at,
            provider_fence: provider_fence.to_owned(),
        })
    }

    pub fn operation(&self) -> &str {
        &self.operation
    }

    pub fn input_hash(&self) -> &str {
        &self.input_hash
    }

    pub fn window_started_at(&self) -> u64 {
        self.window_started_at
    }

    fn object_name(&self) -> String {
        let canonical = serde_json::to_vec(self).expect("model audit intent is serializable");
        let digest = Sha256::digest(canonical);
        format!("provider-intents/v1/{}/{digest:x}.json", self.operation)
    }
}

fn required(value: Option<&str>, name: &'static str) -> Result<String, RollbackAuditError> {
    value
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or(RollbackAuditError::Incomplete(name))
}

fn validate_sweep_interval(start_ms: u64, end_ms: u64) -> Result<(), RollbackAuditError> {
    if start_ms >= end_ms || end_ms.saturating_sub(start_ms) > MAX_SWEEP_WINDOW_MS {
        Err(RollbackAuditError::Configuration(
            "rollback sweep interval must be positive and at most 31 days".to_owned(),
        ))
    } else {
        Ok(())
    }
}

impl RollbackAudit {
    pub fn from_environment(managed: bool) -> Result<Self, RollbackAuditError> {
        let bucket = std::env::var("OPENSHELF_ROLLBACK_AUDIT_BUCKET")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let object_prefix = std::env::var("OPENSHELF_ROLLBACK_AUDIT_PREFIX")
            .ok()
            .filter(|value| !value.trim().is_empty());
        Self::from_configuration(managed, bucket.as_deref(), object_prefix.as_deref())
    }

    fn from_configuration(
        managed: bool,
        bucket: Option<&str>,
        object_prefix: Option<&str>,
    ) -> Result<Self, RollbackAuditError> {
        let Some(bucket) = bucket else {
            if managed {
                return Err(RollbackAuditError::Configuration(
                    "OPENSHELF_ROLLBACK_AUDIT_BUCKET is required in managed environments"
                        .to_owned(),
                ));
            }
            return Ok(Self {
                backend: Arc::new(RollbackAuditBackend::Disabled),
            });
        };
        let bucket = bucket.trim();
        validate_bucket_name(bucket)?;
        let object_prefix = normalize_object_prefix(object_prefix)?;
        let client = Client::builder()
            // The API's outer request timeout is 22 seconds. Seven seconds here
            // still leaves the separately bounded provider call time to finish.
            .timeout(Duration::from_secs(7))
            .build()
            .map_err(|error| RollbackAuditError::Configuration(error.to_string()))?;
        let credentials = CredentialsBuilder::default()
            .with_scopes(["https://www.googleapis.com/auth/devstorage.read_write"])
            .build_access_token_credentials()
            .map_err(|error| RollbackAuditError::Credentials(error.to_string()))?;
        Ok(Self {
            backend: Arc::new(RollbackAuditBackend::Gcs(GcsRollbackAudit {
                bucket: bucket.to_owned(),
                object_prefix,
                client,
                credentials,
            })),
        })
    }

    pub async fn persist(&self, intent: &RollbackAuditIntent) -> Result<(), RollbackAuditError> {
        let bytes = serde_json::to_vec(intent)
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
        self.persist_bytes(&intent.object_name(), bytes).await
    }

    pub async fn persist_model_call(
        &self,
        intent: &ModelCallAuditIntent,
    ) -> Result<(), RollbackAuditError> {
        let bytes = serde_json::to_vec(intent)
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
        self.persist_bytes(&intent.object_name(), bytes).await
    }

    async fn persist_bytes(
        &self,
        object_name: &str,
        bytes: Vec<u8>,
    ) -> Result<(), RollbackAuditError> {
        if bytes.len() > MAX_AUDIT_OBJECT_BYTES {
            return Err(RollbackAuditError::Incomplete(
                "serialized object is too large",
            ));
        }
        match self.backend.as_ref() {
            RollbackAuditBackend::Disabled => Ok(()),
            RollbackAuditBackend::Gcs(backend) => {
                backend
                    .persist_create_only(&backend.qualify_object_name(object_name), &bytes)
                    .await
            }
            #[cfg(test)]
            RollbackAuditBackend::Memory(backend) => backend.persist(object_name, &bytes),
        }
    }

    /// Operator-only PITR input. The runtime writer's bucket role deliberately
    /// lacks list permission; a separately authorized incident identity runs
    /// this bounded scan while every payment ingress remains stopped.
    pub async fn list_intents_created_between(
        &self,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<Vec<RollbackAuditRecord>, RollbackAuditError> {
        validate_sweep_interval(start_ms, end_ms)?;
        match self.backend.as_ref() {
            RollbackAuditBackend::Gcs(backend) => backend.list_intents(start_ms, end_ms).await,
            RollbackAuditBackend::Disabled => Err(RollbackAuditError::Configuration(
                "rollback sweep requires OPENSHELF_ROLLBACK_AUDIT_BUCKET".to_owned(),
            )),
            #[cfg(test)]
            RollbackAuditBackend::Memory(_) => Err(RollbackAuditError::Configuration(
                "memory audit has no independent creation clock".to_owned(),
            )),
        }
    }

    pub async fn list_model_calls_created_between(
        &self,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<Vec<ModelCallAuditRecord>, RollbackAuditError> {
        validate_sweep_interval(start_ms, end_ms)?;
        match self.backend.as_ref() {
            RollbackAuditBackend::Gcs(backend) => backend.list_model_calls(start_ms, end_ms).await,
            RollbackAuditBackend::Disabled => Err(RollbackAuditError::Configuration(
                "rollback sweep requires OPENSHELF_ROLLBACK_AUDIT_BUCKET".to_owned(),
            )),
            #[cfg(test)]
            RollbackAuditBackend::Memory(_) => Err(RollbackAuditError::Configuration(
                "memory audit has no independent creation clock".to_owned(),
            )),
        }
    }

    #[cfg(test)]
    pub fn memory(fail_writes: bool) -> Self {
        Self {
            backend: Arc::new(RollbackAuditBackend::Memory(MemoryRollbackAudit {
                objects: std::sync::Mutex::new(HashMap::new()),
                fail_writes: std::sync::atomic::AtomicBool::new(fail_writes),
            })),
        }
    }

    #[cfg(test)]
    pub fn set_memory_failure(&self, fail_writes: bool) {
        if let RollbackAuditBackend::Memory(backend) = self.backend.as_ref() {
            backend
                .fail_writes
                .store(fail_writes, std::sync::atomic::Ordering::Release);
        }
    }

    #[cfg(test)]
    pub fn memory_object_count(&self) -> usize {
        match self.backend.as_ref() {
            RollbackAuditBackend::Memory(backend) => backend.objects.lock().unwrap().len(),
            _ => 0,
        }
    }
}

impl GcsRollbackAudit {
    fn qualify_object_name(&self, object_name: &str) -> String {
        format!("{}{object_name}", self.object_prefix)
    }

    fn logical_object_name<'a>(&self, object_name: &'a str) -> Result<&'a str, RollbackAuditError> {
        object_name
            .strip_prefix(&self.object_prefix)
            .filter(|value| !value.is_empty())
            .ok_or(RollbackAuditError::Conflict)
    }

    async fn persist_create_only(
        &self,
        object_name: &str,
        bytes: &[u8],
    ) -> Result<(), RollbackAuditError> {
        let token = self
            .credentials
            .access_token()
            .await
            .map_err(|error| RollbackAuditError::Credentials(error.to_string()))?;
        let (boundary, multipart_body) = gcs_multipart_upload(object_name, bytes)?;
        let response = self
            .client
            .post(format!(
                "https://storage.googleapis.com/upload/storage/v1/b/{}/o",
                self.bucket
            ))
            .query(&[("uploadType", "multipart"), ("ifGenerationMatch", "0")])
            .bearer_auth(&token.token)
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/related; boundary={boundary}"),
            )
            .body(multipart_body)
            .send()
            .await
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
        if response.status().is_success() {
            let body = bounded_response_body(response, 64 * 1_024).await?;
            let metadata: GcsObjectWriteMetadata = serde_json::from_slice(&body)
                .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
            return validate_held_object_metadata(object_name, &metadata);
        }
        if response.status() != StatusCode::PRECONDITION_FAILED {
            return Err(RollbackAuditError::Transport(format!(
                "GCS create-only upload returned {}",
                response.status()
            )));
        }
        let existing = self.read_object(object_name, &token.token).await?;
        let metadata = self.read_object_metadata(object_name, &token.token).await?;
        if existing == bytes {
            validate_held_object_metadata(object_name, &metadata)
        } else {
            Err(RollbackAuditError::Conflict)
        }
    }

    async fn read_object_metadata(
        &self,
        object_name: &str,
        access_token: &str,
    ) -> Result<GcsObjectWriteMetadata, RollbackAuditError> {
        let mut url = gcs_metadata_url(&self.bucket, object_name)?;
        url.query_pairs_mut()
            .append_pair("fields", "name,temporaryHold");
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?
            .error_for_status()
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
        let body = bounded_response_body(response, 64 * 1_024).await?;
        serde_json::from_slice(&body)
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))
    }

    async fn read_object(
        &self,
        object_name: &str,
        access_token: &str,
    ) -> Result<Vec<u8>, RollbackAuditError> {
        let url = gcs_download_url(&self.bucket, object_name)?;
        let mut response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?
            .error_for_status()
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| RollbackAuditError::Transport(error.to_string()))?
        {
            if body.len().saturating_add(chunk.len()) > MAX_AUDIT_OBJECT_BYTES {
                return Err(RollbackAuditError::Conflict);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    async fn list_intents(
        &self,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<Vec<RollbackAuditRecord>, RollbackAuditError> {
        let mut records = Vec::new();
        for version in [1_u8, 2, 3] {
            let logical_prefix = format!("intents/v{version}/");
            let (token, objects) = self
                .list_object_metadata(&self.qualify_object_name(&logical_prefix), start_ms, end_ms)
                .await?;
            for (object_name, created_at_ms) in objects {
                let object = self.read_object(&object_name, &token).await?;
                let intent: RollbackAuditIntent = serde_json::from_slice(&object)
                    .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
                if intent.version != version
                    || intent.object_name() != self.logical_object_name(&object_name)?
                {
                    return Err(RollbackAuditError::Conflict);
                }
                records.push(RollbackAuditRecord {
                    object_name,
                    created_at_ms,
                    intent,
                });
            }
        }
        Ok(records)
    }

    async fn list_model_calls(
        &self,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<Vec<ModelCallAuditRecord>, RollbackAuditError> {
        let (token, objects) = self
            .list_object_metadata(
                &self.qualify_object_name("provider-intents/v1/"),
                start_ms,
                end_ms,
            )
            .await?;
        let mut records = Vec::new();
        for (object_name, created_at_ms) in objects {
            let object = self.read_object(&object_name, &token).await?;
            let intent: ModelCallAuditIntent = serde_json::from_slice(&object)
                .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
            if intent.version != 1
                || intent.object_name() != self.logical_object_name(&object_name)?
            {
                return Err(RollbackAuditError::Conflict);
            }
            records.push(ModelCallAuditRecord {
                object_name,
                created_at_ms,
                intent,
            });
        }
        Ok(records)
    }

    async fn list_object_metadata(
        &self,
        prefix: &str,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<(String, Vec<(String, u64)>), RollbackAuditError> {
        let token = self
            .credentials
            .access_token()
            .await
            .map_err(|error| RollbackAuditError::Credentials(error.to_string()))?;
        let mut page_token: Option<String> = None;
        let mut seen_page_tokens = HashSet::new();
        let mut pages = 0_usize;
        let mut objects = Vec::new();
        loop {
            pages = pages
                .checked_add(1)
                .ok_or(RollbackAuditError::SweepLimit("GCS page count"))?;
            if pages > MAX_GCS_LIST_PAGES {
                return Err(RollbackAuditError::SweepLimit("GCS page count"));
            }
            let mut request = self
                .client
                .get(format!(
                    "https://storage.googleapis.com/storage/v1/b/{}/o",
                    self.bucket
                ))
                .query(&[
                    ("prefix", prefix),
                    ("maxResults", "1000"),
                    (
                        "fields",
                        "items(name,timeCreated,temporaryHold),nextPageToken",
                    ),
                ])
                .bearer_auth(&token.token);
            if let Some(page_token) = page_token.as_deref() {
                request = request.query(&[("pageToken", page_token)]);
            }
            let response = request
                .send()
                .await
                .map_err(|error| RollbackAuditError::Transport(error.to_string()))?
                .error_for_status()
                .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
            let body = bounded_response_body(response, MAX_GCS_LIST_RESPONSE_BYTES).await?;
            let page: GcsObjectList = serde_json::from_slice(&body)
                .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
            for item in page.items {
                if !item.name.starts_with(prefix) || item.name.len() > 512 || !item.temporary_hold {
                    return Err(RollbackAuditError::Conflict);
                }
                let created_at = OffsetDateTime::parse(&item.time_created, &Rfc3339)
                    .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
                let created_at_ms = u64::try_from(created_at.unix_timestamp_nanos() / 1_000_000)
                    .map_err(|_| {
                        RollbackAuditError::Transport(
                            "GCS returned a pre-epoch object timestamp".to_owned(),
                        )
                    })?;
                if created_at_ms >= start_ms && created_at_ms < end_ms {
                    if objects.len() >= MAX_SWEEP_MATCHING_OBJECTS {
                        return Err(RollbackAuditError::SweepLimit(
                            "matching audit object count",
                        ));
                    }
                    objects.push((item.name, created_at_ms));
                }
            }
            page_token = validated_next_page_token(page.next_page_token, &mut seen_page_tokens)?;
            if page_token.is_none() {
                break;
            }
        }
        objects.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
        Ok((token.token, objects))
    }
}

fn validated_next_page_token(
    page_token: Option<String>,
    seen: &mut HashSet<String>,
) -> Result<Option<String>, RollbackAuditError> {
    let Some(page_token) = page_token else {
        return Ok(None);
    };
    if page_token.is_empty() || page_token.len() > 4_096 || !seen.insert(page_token.clone()) {
        return Err(RollbackAuditError::Conflict);
    }
    Ok(Some(page_token))
}

fn gcs_download_url(bucket: &str, object_name: &str) -> Result<Url, RollbackAuditError> {
    let mut url = Url::parse("https://storage.googleapis.com/download/storage/v1/b")
        .map_err(|error| RollbackAuditError::Configuration(error.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| RollbackAuditError::Configuration("invalid GCS URL".to_owned()))?
        .push(bucket)
        .push("o")
        // JSON API object names occupy one URL segment. Encoding these slashes
        // is required; treating them as route separators returns the wrong key.
        .push(object_name);
    url.query_pairs_mut().append_pair("alt", "media");
    Ok(url)
}

fn gcs_metadata_url(bucket: &str, object_name: &str) -> Result<Url, RollbackAuditError> {
    let mut url = Url::parse("https://storage.googleapis.com/storage/v1/b")
        .map_err(|error| RollbackAuditError::Configuration(error.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| RollbackAuditError::Configuration("invalid GCS URL".to_owned()))?
        .push(bucket)
        .push("o")
        .push(object_name);
    Ok(url)
}

fn validate_held_object_metadata(
    expected_name: &str,
    metadata: &GcsObjectWriteMetadata,
) -> Result<(), RollbackAuditError> {
    if metadata.name == expected_name && metadata.temporary_hold {
        Ok(())
    } else {
        Err(RollbackAuditError::Conflict)
    }
}

fn gcs_multipart_upload(
    object_name: &str,
    bytes: &[u8],
) -> Result<(String, Vec<u8>), RollbackAuditError> {
    let digest = Sha256::digest(
        object_name
            .as_bytes()
            .iter()
            .copied()
            .chain(bytes.iter().copied())
            .collect::<Vec<_>>(),
    );
    let boundary = (0_u16..=u8::MAX as u16)
        .map(|suffix| {
            if suffix == 0 {
                format!("openshelf-audit-{digest:x}")
            } else {
                format!("openshelf-audit-{digest:x}-{suffix}")
            }
        })
        .find(|candidate| {
            !bytes
                .windows(candidate.len())
                .any(|window| window == candidate.as_bytes())
        })
        .ok_or_else(|| {
            RollbackAuditError::Configuration(
                "could not construct a safe multipart boundary".to_owned(),
            )
        })?;
    let metadata = serde_json::to_vec(&serde_json::json!({
        "name": object_name,
        "temporaryHold": true,
        "contentType": "application/json",
        "cacheControl": "no-store",
    }))
    .map_err(|error| RollbackAuditError::Transport(error.to_string()))?;
    let mut body = Vec::with_capacity(metadata.len() + bytes.len() + boundary.len() * 3 + 256);
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(&metadata);
    body.extend_from_slice(format!("\r\n--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Type: application/json\r\n\r\n");
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    Ok((boundary, body))
}

async fn bounded_response_body(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, RollbackAuditError> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| RollbackAuditError::Transport(error.to_string()))?
    {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(RollbackAuditError::Transport(
                "GCS response exceeded the configured bound".to_owned(),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
impl MemoryRollbackAudit {
    fn persist(&self, object_name: &str, bytes: &[u8]) -> Result<(), RollbackAuditError> {
        if self.fail_writes.load(std::sync::atomic::Ordering::Acquire) {
            return Err(RollbackAuditError::Transport(
                "injected audit outage".to_owned(),
            ));
        }
        let mut objects = self.objects.lock().unwrap();
        match objects.get(object_name) {
            Some(existing) if existing == bytes => Ok(()),
            Some(_) => Err(RollbackAuditError::Conflict),
            None => {
                objects.insert(object_name.to_owned(), bytes.to_vec());
                Ok(())
            }
        }
    }
}

fn validate_bucket_name(value: &str) -> Result<(), RollbackAuditError> {
    let valid = (3..=63).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_.".contains(&byte)
        })
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && !value.contains("..")
        && !value.starts_with("goog")
        && !value.contains("google");
    if valid {
        Ok(())
    } else {
        Err(RollbackAuditError::Configuration(
            "bucket name must be a plain, lower-case GCS bucket name".to_owned(),
        ))
    }
}

fn normalize_object_prefix(value: Option<&str>) -> Result<String, RollbackAuditError> {
    let Some(value) = value else {
        return Ok(String::new());
    };
    let trimmed = value.trim();
    let valid = !trimmed.is_empty()
        && trimmed == value
        && trimmed.len() <= 240
        && !trimmed.starts_with('/')
        && !trimmed.ends_with('/')
        && trimmed.split('/').all(|segment| {
            (1..=63).contains(&segment.len())
                && segment.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_.".contains(&byte)
                })
                && segment
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && !segment.contains("..")
        });
    if valid {
        Ok(format!("{trimmed}/"))
    } else {
        Err(RollbackAuditError::Configuration(
            "rollback audit prefix must be lower-case path segments without a leading or trailing slash"
                .to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payout_audit_requires_a_nonzero_signature_and_x402_requires_the_real_partial_shape() {
        let unsigned = BASE64_STANDARD.encode([0_u8; 180]);
        assert!(transaction_signature(&unsigned, "signature").is_err());

        let mut signed = [19_u8; 180];
        signed[0] = 1;
        assert_eq!(
            transaction_signature(&BASE64_STANDARD.encode(signed), "signature").unwrap(),
            bs58::encode([19_u8; 64]).into_string()
        );

        let mut prepared = [31_u8; 180];
        prepared[0] = 2;
        prepared[1..65].fill(0);
        assert!(x402_prepared_transaction(&BASE64_STANDARD.encode(prepared)).is_ok());

        prepared[1] = 1;
        assert!(x402_prepared_transaction(&BASE64_STANDARD.encode(prepared)).is_err());
        prepared[1] = 0;
        prepared[65..129].fill(0);
        assert!(x402_prepared_transaction(&BASE64_STANDARD.encode(prepared)).is_err());
    }

    #[test]
    fn a_repeated_or_malformed_gcs_page_token_cannot_stall_a_stopped_restore() {
        let mut seen = HashSet::new();
        assert_eq!(
            validated_next_page_token(Some("next-page".to_owned()), &mut seen).unwrap(),
            Some("next-page".to_owned())
        );
        assert!(matches!(
            validated_next_page_token(Some("next-page".to_owned()), &mut seen),
            Err(RollbackAuditError::Conflict)
        ));
        assert!(matches!(
            validated_next_page_token(Some(String::new()), &mut HashSet::new()),
            Err(RollbackAuditError::Conflict)
        ));
        assert!(matches!(
            validated_next_page_token(Some("x".repeat(4_097)), &mut HashSet::new()),
            Err(RollbackAuditError::Conflict)
        ));
    }

    fn intent(amount: &str) -> RollbackAuditIntent {
        RollbackAuditIntent {
            version: 1,
            rail: "x402".to_owned(),
            operation: "document".to_owned(),
            event_id: "f".repeat(64),
            quote_id: Some("quote-real-retry".to_owned()),
            job_id: None,
            network: "solana:devnet".to_owned(),
            asset: "usdc".to_owned(),
            amount_atomic: amount.to_owned(),
            payer: Some("payer".to_owned()),
            recipient_wallet: "recipient".to_owned(),
            platform_recipient_wallet: None,
            owner_amount_atomic: None,
            platform_amount_atomic: None,
            signed_transaction_base64: "signed".to_owned(),
            recent_blockhash: "blockhash".to_owned(),
            challenge_id: None,
            external_id: None,
            challenge_expires_at: None,
            transaction_signature: None,
            last_valid_block_height: None,
        }
    }

    #[tokio::test]
    async fn create_only_audit_recovers_exact_retry_and_rejects_changed_economics() {
        let audit = RollbackAudit::memory(true);
        assert!(audit.persist(&intent("500000")).await.is_err());
        assert_eq!(audit.memory_object_count(), 0);

        audit.set_memory_failure(false);
        audit.persist(&intent("500000")).await.unwrap();
        audit.persist(&intent("500000")).await.unwrap();
        assert_eq!(audit.memory_object_count(), 1);

        assert!(matches!(
            audit.persist(&intent("900000")).await,
            Err(RollbackAuditError::Conflict)
        ));
        assert_eq!(audit.memory_object_count(), 1);
    }

    #[test]
    fn exact_partial_x402_intents_do_not_collide_with_legacy_create_only_objects() {
        let legacy = intent("500000");
        let mut exact_partial = legacy.clone();
        exact_partial.version = 3;
        assert!(legacy.object_name().starts_with("intents/v1/"));
        assert!(exact_partial.object_name().starts_with("intents/v3/"));
        assert_ne!(legacy.object_name(), exact_partial.object_name());
    }

    #[test]
    fn bucket_configuration_cannot_smuggle_a_url_or_object_prefix() {
        assert!(validate_bucket_name("obolus-rollback-audit").is_ok());
        for invalid in [
            "https://storage.googleapis.com/bucket",
            "Bucket",
            "ab",
            "bucket/object",
            "bucket..shadow",
            "goog-audit",
        ] {
            assert!(validate_bucket_name(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn managed_runtime_cannot_start_without_independent_audit_storage() {
        assert!(matches!(
            RollbackAudit::from_configuration(true, None, None),
            Err(RollbackAuditError::Configuration(message))
                if message.contains("required in managed environments")
        ));
        assert!(RollbackAudit::from_configuration(false, None, None).is_ok());
    }

    #[test]
    fn a_shared_bucket_prefix_is_canonical_and_cannot_escape_its_scope() {
        assert_eq!(
            normalize_object_prefix(Some("obolus/rollback-audit")).unwrap(),
            "obolus/rollback-audit/"
        );
        for invalid in [
            "/obolus",
            "obolus/",
            "obolus//audit",
            "obolus/../audit",
            "Obolus/audit",
            "https://storage.googleapis.com/bucket",
        ] {
            assert!(
                normalize_object_prefix(Some(invalid)).is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn gcs_download_encodes_the_entire_create_only_object_name_as_one_segment() {
        let url = gcs_download_url("obolus-rollback-audit", "intents/v1/x402/abcdef.json").unwrap();
        assert_eq!(
            url.as_str(),
            "https://storage.googleapis.com/download/storage/v1/b/obolus-rollback-audit/o/intents%2Fv1%2Fx402%2Fabcdef.json?alt=media"
        );
    }

    #[test]
    fn gcs_create_is_a_single_create_only_multipart_with_a_temporary_hold() {
        let object_name = "obolus/rollback-audit/intents/v3/x402/abcdef.json";
        let object = br#"{"version":3,"rail":"x402"}"#;
        let (boundary, body) = gcs_multipart_upload(object_name, object).unwrap();
        let body_text = String::from_utf8(body).unwrap();
        assert!(body_text.starts_with(&format!("--{boundary}\r\n")));
        assert!(body_text.contains(&format!(r#""name":"{object_name}""#)));
        assert!(body_text.contains(r#""temporaryHold":true"#));
        assert!(body_text.contains(r#""cacheControl":"no-store""#));
        assert!(body_text.contains("\r\nContent-Type: application/json\r\n\r\n"));
        assert!(body_text.ends_with(&format!("\r\n--{boundary}--\r\n")));
        assert_eq!(body_text.matches(&boundary).count(), 3);
    }

    #[test]
    fn a_successful_or_retried_audit_object_must_still_be_held() {
        let expected = "obolus/rollback-audit/intents/v3/x402/abcdef.json";
        assert!(
            validate_held_object_metadata(
                expected,
                &GcsObjectWriteMetadata {
                    name: expected.to_owned(),
                    temporary_hold: true,
                },
            )
            .is_ok()
        );
        for metadata in [
            GcsObjectWriteMetadata {
                name: expected.to_owned(),
                temporary_hold: false,
            },
            GcsObjectWriteMetadata {
                name: "other.json".to_owned(),
                temporary_hold: true,
            },
        ] {
            assert!(matches!(
                validate_held_object_metadata(expected, &metadata),
                Err(RollbackAuditError::Conflict)
            ));
        }
    }
}
