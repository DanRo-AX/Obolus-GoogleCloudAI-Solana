use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Instant;

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{Duration as TimeDuration, OffsetDateTime, format_description::well_known::Rfc3339};

use crate::{
    domain::{
        AccountControls, AdminDataPipelineSnapshot, AdminDeploymentInfo, AdminOperationsSnapshot,
        AdminTablePage, AgentAuthResponse, AgentRun, AgentStep, AgentStepStatus, AgentTool,
        AiLiquidityMetrics, AuthResponse, BalanceSummary, BeginResearchPaymentRequest,
        BindPayShChallengesRequest, ChainSettlementReceipt, ChatAnswer, ClaimPaymentAttemptRequest,
        CompletePayoutClaimRequest, ContributorManifest, ContributorMemoryLink,
        ContributorNotification, CorrectMemoryRequest, CreateEvidenceEdgeRequest,
        CreateOpenCallRequest, CreatePaymentBundleRequest, CreatePrepaidSessionRequest,
        CreatePrepaidWithdrawalRequest, DeferResearchPaymentRequest,
        DirectPayShPaymentReconciliation, DisputeCase, DocumentFeedback, EarningsSummary,
        EvidenceEdge, FailPayoutClaimRequest, FailResearchJobRequest, ForgotPasswordRequest,
        GenerateAiBaselineResponse, GenerateShelfStartersResponse, LeasePayoutClaimsRequest,
        LoginRequest, MarkNotificationsReadRequest, MemoryEntry, MemoryExport, OpenCall,
        OpenCallFundingQuote, OpenCallFundingSnapshot, OpenCallReservation, OpenDocumentsResponse,
        PaidDocument, PayShResource, PaymentAttemptFence, PaymentAttemptReconciliation,
        PaymentAttemptRelease, PaymentBundleQuote, PaymentBundleSnapshot, PaymentDocumentSnapshot,
        PaymentProgress, PaymentQuote, PayoutClaim, PayoutClaimBacklog, PrepaidBalance,
        PrepaidWalletSession, PrepareDirectPayShPaymentRequest, PreparePayoutClaimRequest,
        PrepareResearchPaymentRequest, PublicDocument, PublicEvidenceRecord,
        RecordChainSettlementRequest, RecordPrepaidDepositRequest, RecoveredPaidDocument,
        RegisterRequest, ReleaseResearchPaymentRequest, ResearchJobPlan, ResearchJobStatus,
        ResearchPaymentReconciliation, ResetPasswordRequest, ResolveError, ResolveQuestionRequest,
        ResolveQuestionResponse, ReviewDisputeRequest, ReviewDocumentFeedbackRequest,
        SettleResearchPaymentRequest, SettlementPreviewRequest, ShelfStarter, SiwxPayload,
        SubmitAnswerRequest, SubmitAnswerResponse, SubmitDisputeRequest,
        SubmitDocumentFeedbackRequest, SubmitShelfStarterAnswerRequest,
        SubmitShelfStarterAnswerResponse, SynthesizeAnswerRequest, SynthesizeAnswerResponse,
        SynthesizePaidAnswerRequest, UpdateMemoryRequest, UpdatePreferencesRequest,
        UpsertProfileRequest, UserAccount, UserProfile, VerifyWalletRequest, WalletAuthChallenge,
        WalletAuthChallengeRequest, WalletAuthSiwxRequest, WalletAuthVerifyRequest,
        WalletChallenge, WalletChallengePurpose, WalletChallengeRequest, WalletSiwxLink,
    },
    environment::{
        boolean_value, managed_runtime_environment, monotonic_unix_time_ms, unsigned_integer_value,
    },
    orchestrator,
    rollback_audit::{ModelCallAuditIntent, RollbackAudit, RollbackAuditIntent},
    search::{ResolveTraceStage, Resolver},
    store::{
        AdminTable, AiArtifactMetadata, AiGenerationClaim, PayShDeliveryRequest,
        PaymentQuotePolicy, Store, StoreError,
    },
};

const SESSION_COOKIE: &str = "openshelf_session";
const WALLET_ONLY_PASSWORD_MARKER: &str = "wallet-only-authentication-disabled";
const PREPAID_SESSION_HEADER: &str = "x-openshelf-wallet-session";
/// Same-origin HttpOnly cookie carrying the prepaid wallet session token,
/// added alongside PREPAID_SESSION_HEADER (GitHub issue #46). Direct
/// browser-to-Rust calls (payment_bundle_quote_for_payer) can rely on the
/// cookie alone; requests that must reach the separate payment-gateway
/// service (a different origin in local dev, and outside this fix's Rust +
/// frontend scope to modify) still carry the header explicitly. See
/// prepaid_session_token below and src/lib/x402.ts's tab-scoped in-memory
/// fallback.
const PREPAID_SESSION_COOKIE: &str = "openshelf_prepaid_session";
const SESSION_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// Reduced from an earlier 30-day default (GitHub issue #46): a bearer able
/// to spend deposited prepaid credit for a month is a large blast radius if
/// leaked. Keep in sync with the validation upper bound in
/// Store::issue_prepaid_wallet_session.
const PREPAID_SESSION_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const INTERNAL_TOKEN_HEADER: &str = "x-openshelf-internal-token";
const RESEARCH_PROTOCOL_HEADER: &str = "x-openshelf-research-protocol";
const RESEARCH_PROTOCOL_VERSION: &str = "durable-mpp-v2";
const PAYMENT_PROTOCOL_HEADER: &str = "x-openshelf-payment-protocol";
const PAYMENT_PROTOCOL_VERSION: &str = "exact-chain-v1";
const PAYOUT_PROTOCOL_HEADER: &str = "x-openshelf-payout-protocol";
const PAYOUT_PROTOCOL_VERSION: &str = "exact-payout-v1";
const QUERY_TOKEN_HEADER: &str = "x-openshelf-query-token";
const DIRECT_PAY_ATTEMPT_HEADER: &str = "x-openshelf-pay-attempt";
const DEFAULT_INTERNAL_TOKEN: &str = "openshelf-local-internal";
const DEVNET_NETWORK: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAY_SH_KRW_PER_USDC: u64 = 1_350;
// A syntactically valid Argon2id record with a deliberately unrelated output.
// Unknown-email login still performs the same memory-hard verification work.
const DUMMY_PASSWORD_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$b3BlbnNoZWxmLWR1bW15$c29tZS1kdW1teS1oYXNoLXZhbHVlLTEyMzQ1Njc4OTA";

pub struct AppState {
    store: Store,
    internal_token_hash: String,
    payment_policy: PaymentQuotePolicy,
    secure_cookies: bool,
    environment: String,
    allow_demo_open: bool,
    accept_legacy_pay_sh_callbacks: bool,
    frontend_origin: String,
    agent_api_origin: String,
    email_password_auth_enabled: bool,
    email_endpoint: Option<String>,
    email_api_key: Option<String>,
    email_from: Option<String>,
    ai_baseline_ttl_ms: u64,
    email_delivery_active: AtomicBool,
    email_worker_id: String,
    rollback_audit: RollbackAudit,
}

struct EmailDeliveryGuard<'a>(&'a AtomicBool);

impl Drop for EmailDeliveryGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl AppState {
    pub fn new(store: Store) -> Self {
        let environment =
            std::env::var("OPENSHELF_ENV").unwrap_or_else(|_| "development".to_owned());
        let production = managed_runtime_environment(&environment)
            .unwrap_or_else(|error| panic!("invalid deployment environment: {error}"));
        if production
            && store
                .contains_demo_seed_data()
                .unwrap_or_else(|error| panic!("failed to inspect production database: {error}"))
        {
            panic!(
                "production database contains demo seed data; migrate to a clean production database"
            );
        }
        let configured_internal_token = std::env::var("OPENSHELF_INTERNAL_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty());
        if production
            && configured_internal_token
                .as_deref()
                .is_none_or(|value| value == DEFAULT_INTERNAL_TOKEN || value.len() < 32)
        {
            panic!(
                "OPENSHELF_INTERNAL_TOKEN must be a non-default secret of at least 32 characters in production"
            );
        }
        let internal_token =
            configured_internal_token.unwrap_or_else(|| DEFAULT_INTERNAL_TOKEN.to_owned());
        let network =
            std::env::var("OPENSHELF_X402_NETWORK").unwrap_or_else(|_| DEVNET_NETWORK.to_owned());
        let asset =
            std::env::var("OPENSHELF_X402_ASSET").unwrap_or_else(|_| DEVNET_USDC.to_owned());
        if env_bool("OPENSHELF_REQUIRE_MAINNET", false)
            && (network == DEVNET_NETWORK || asset == DEVNET_USDC)
        {
            panic!("mainnet mode cannot use the default Solana Devnet network or USDC mint");
        }
        let secure_cookies = env_bool("OPENSHELF_SECURE_COOKIES", production);
        if production && !secure_cookies {
            panic!("OPENSHELF_SECURE_COOKIES cannot be disabled in production");
        }
        let allow_demo_open = env_bool("OPENSHELF_ALLOW_DEMO_OPEN", !production);
        if production && allow_demo_open {
            panic!("OPENSHELF_ALLOW_DEMO_OPEN cannot be enabled in production");
        }
        let accept_legacy_pay_sh_callbacks =
            env_bool("OPENSHELF_ACCEPT_LEGACY_PAY_SH_CALLBACKS", false);
        let frontend_origin = validate_service_origin(
            "OPENSHELF_FRONTEND_ORIGIN",
            &std::env::var("OPENSHELF_FRONTEND_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:4319".to_owned()),
            production,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let agent_api_origin = validate_service_origin(
            "OPENSHELF_AGENT_API_ORIGIN",
            &std::env::var("OPENSHELF_AGENT_API_ORIGIN")
                .unwrap_or_else(|_| "http://127.0.0.1:8787".to_owned()),
            production,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let email_password_auth_enabled = env_bool("OPENSHELF_EMAIL_PASSWORD_AUTH_ENABLED", false);
        let email_endpoint = std::env::var("OPENSHELF_EMAIL_ENDPOINT")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let email_api_key = std::env::var("OPENSHELF_EMAIL_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let email_from = std::env::var("OPENSHELF_EMAIL_FROM")
            .ok()
            .filter(|value| !value.trim().is_empty());
        validate_email_configuration(
            email_endpoint.as_deref(),
            email_api_key.as_deref(),
            email_from.as_deref(),
            production,
            production && email_password_auth_enabled,
        )
        .unwrap_or_else(|error| panic!("invalid email delivery configuration: {error}"));
        let krw_per_usdc = env_u64("OPENSHELF_KRW_PER_USDC", 1_350);
        let quote_ttl_ms = env_u64("OPENSHELF_QUOTE_TTL_MS", 300_000);
        let ai_baseline_ttl_ms = env_u64("OPENSHELF_AI_BASELINE_TTL_MS", 21_600_000);
        if krw_per_usdc == 0 || krw_per_usdc > 1_000_000_000 {
            panic!("OPENSHELF_KRW_PER_USDC must be between 1 and 1000000000");
        }
        if !(30_000..=86_400_000).contains(&quote_ttl_ms) {
            panic!("OPENSHELF_QUOTE_TTL_MS must be between 30000 and 86400000");
        }
        if !(60_000..=86_400_000).contains(&ai_baseline_ttl_ms) {
            panic!("OPENSHELF_AI_BASELINE_TTL_MS must be between 60000 and 86400000");
        }
        if production && krw_per_usdc != PAY_SH_KRW_PER_USDC {
            panic!(
                "OPENSHELF_KRW_PER_USDC must match the fixed Pay.sh price schedule in a managed environment"
            );
        }
        let rollback_audit = RollbackAudit::from_environment(production)
            .unwrap_or_else(|error| panic!("invalid rollback audit configuration: {error}"));
        Self {
            store,
            internal_token_hash: token_hash(&internal_token),
            payment_policy: PaymentQuotePolicy {
                fallback_recipient: std::env::var("OPENSHELF_DEFAULT_RECEIVER")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                bundle_recipient: std::env::var("OPENSHELF_BUNDLE_RECEIVER")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| {
                        std::env::var("OPENSHELF_DEFAULT_RECEIVER")
                            .ok()
                            .filter(|value| !value.trim().is_empty())
                    }),
                network,
                asset,
                krw_per_usdc,
                ttl_ms: quote_ttl_ms,
            },
            secure_cookies,
            allow_demo_open,
            accept_legacy_pay_sh_callbacks,
            frontend_origin,
            agent_api_origin,
            environment,
            email_password_auth_enabled,
            email_endpoint,
            email_api_key,
            email_from,
            ai_baseline_ttl_ms,
            email_delivery_active: AtomicBool::new(false),
            email_worker_id: random_token(),
            rollback_audit,
        }
    }

    #[cfg(test)]
    fn with_demo_open(mut self, allowed: bool) -> Self {
        self.allow_demo_open = allowed;
        self
    }

    #[cfg(test)]
    fn with_rollback_audit(mut self, rollback_audit: RollbackAudit) -> Self {
        self.rollback_audit = rollback_audit;
        self
    }

    pub(crate) fn with_email_password_auth_enabled(mut self, enabled: bool) -> Self {
        self.email_password_auth_enabled = enabled;
        self
    }

    pub(crate) fn frontend_origin(&self) -> &str {
        &self.frontend_origin
    }

    /// Store a classified, content-free request event for the administrator
    /// data-plane view. Failures are intentionally left to the caller to log:
    /// observability must never change the product request's response.
    pub(crate) fn record_system_event(
        &self,
        source: &str,
        instance: &str,
        stage: &str,
        action: &str,
        status: u16,
        latency_ms: u64,
    ) -> Result<(), StoreError> {
        self.store
            .record_system_event(source, instance, stage, action, status, latency_ms)
    }

    fn deployment_info(&self) -> AdminDeploymentInfo {
        let cloud_run_service = std::env::var("K_SERVICE").ok();
        AdminDeploymentInfo {
            runtime: if cloud_run_service.is_some() {
                "Cloud Run".to_owned()
            } else {
                "Local runtime".to_owned()
            },
            environment: self.environment.clone(),
            service: cloud_run_service,
            revision: std::env::var("K_REVISION").ok(),
            project: std::env::var("GOOGLE_CLOUD_PROJECT")
                .or_else(|_| std::env::var("GCLOUD_PROJECT"))
                .ok(),
            location: std::env::var("GOOGLE_CLOUD_LOCATION").ok(),
            vertex_model: std::env::var("OPENSHELF_VERTEX_MODEL")
                .unwrap_or_else(|_| "gemini-2.5-flash".to_owned()),
            database: String::new(),
        }
    }

    async fn deliver_pending_emails(&self) {
        let (Some(endpoint), Some(api_key), Some(from)) = (
            self.email_endpoint.as_deref(),
            self.email_api_key.as_deref(),
            self.email_from.as_deref(),
        ) else {
            return;
        };
        if self
            .email_delivery_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let _delivery_guard = EmailDeliveryGuard(&self.email_delivery_active);
        let emails = match self
            .store
            .lease_pending_emails(&self.email_worker_id, 25, 15 * 60_000)
        {
            Ok(emails) => emails,
            Err(error) => {
                tracing::warn!(%error, "could not load notification email outbox");
                return;
            }
        };
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "could not build notification email client");
                return;
            }
        };
        for email in emails {
            let response = client
                .post(endpoint)
                .bearer_auth(api_key)
                .header("idempotency-key", &email.id)
                .json(&serde_json::json!({
                    "from": from,
                    "to": [email.recipient],
                    "subject": email.subject,
                    "text": email.body,
                }))
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    let _ = self
                        .store
                        .mark_email_delivered(&email.id, &self.email_worker_id);
                }
                Ok(response) => {
                    let status = response.status();
                    let result = self.store.mark_email_failed(
                        &email.id,
                        &self.email_worker_id,
                        &format!("email provider returned HTTP {status}"),
                    );
                    report_email_failure(&email.id, result);
                }
                Err(error) => {
                    let result = self.store.mark_email_failed(
                        &email.id,
                        &self.email_worker_id,
                        &error.to_string(),
                    );
                    report_email_failure(&email.id, result);
                }
            }
        }
    }

    fn dispatch_pending_emails(state: Arc<Self>) {
        tokio::spawn(async move {
            state.deliver_pending_emails().await;
        });
    }

    pub(crate) fn start_email_delivery_loop(state: &Arc<Self>) {
        if state.email_endpoint.is_none() || tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let weak = Arc::downgrade(state);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let Some(state) = weak.upgrade() else {
                    break;
                };
                state.deliver_pending_emails().await;
            }
        });
    }
}

fn report_email_failure(id: &str, result: Result<bool, StoreError>) {
    match result {
        Ok(true) => tracing::error!(email_id = %id, "email delivery exhausted its retry budget"),
        Ok(false) => {}
        Err(error) => tracing::warn!(email_id = %id, %error, "could not persist email failure"),
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let email_password_auth_enabled = state.email_password_auth_enabled;
    let mut router = Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .route(
            "/api/v1/auth/wallet/challenge",
            post(create_wallet_auth_challenge),
        )
        .route("/api/v1/auth/wallet/verify", post(verify_wallet_auth))
        .route(
            "/api/v1/auth/wallet/siwx",
            post(create_wallet_auth_siwx_link),
        )
        .route(
            "/api/v1/auth/wallet/siwx/{id}",
            get(verify_wallet_auth_siwx_link),
        )
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/questions/resolve", post(resolve_question))
        .route("/api/v1/public-evidence", get(list_public_evidence))
        .route(
            "/api/v1/questions/{id}/ai-baseline",
            post(generate_ai_baseline),
        )
        .route(
            "/api/v1/shelf-starters",
            get(list_shelf_starters).post(generate_shelf_starters),
        )
        .route(
            "/api/v1/shelf-starters/{id}/answer",
            post(submit_shelf_starter_answer),
        )
        .route("/api/v1/answers/synthesize", post(synthesize_answer))
        .route(
            "/api/v1/questions/{id}/payment-progress",
            get(payment_progress),
        )
        .route(
            "/api/v1/questions/{query_id}/paid-documents/{handle}",
            get(recover_paid_document),
        )
        .route(
            "/api/v1/questions/{query_id}/paid-documents/{handle}/feedback",
            post(submit_document_feedback),
        )
        .route(
            "/api/v1/open-calls",
            get(list_open_calls).post(create_open_call),
        )
        .route(
            "/api/v1/open-call-funding-quotes",
            post(create_open_call_funding_quote),
        )
        .route(
            "/api/v1/open-call-funding-quotes/{id}",
            get(open_call_funding_quote_for_owner),
        )
        .route("/api/v1/open-calls/{id}/answers", post(submit_answer))
        .route(
            "/api/v1/open-calls/{id}/reservation",
            post(reserve_open_call).delete(release_open_call_reservation),
        )
        .route(
            "/api/v1/open-calls/{id}/reservation/release",
            post(release_open_call_reservation),
        )
        .route("/api/v1/open-calls/{id}", delete(cancel_open_call))
        .route("/api/v1/notifications", get(list_notifications))
        .route("/api/v1/notifications/read", post(mark_notifications_read))
        .route("/api/v1/chats/{id}/answers", get(chat_answers))
        .route("/api/v1/memory", get(list_memory))
        .route("/api/v1/memory/{id}", patch(update_memory))
        .route("/api/v1/memory/{id}/corrections", post(correct_memory))
        .route("/api/v1/memory/{id}/dispute", post(submit_dispute))
        .route("/api/v1/disputes/me", get(my_dispute))
        .route("/api/v1/admin/disputes", get(list_disputes))
        .route("/api/v1/admin/evidence-edges", post(create_evidence_edge))
        .route(
            "/api/v1/admin/ai-liquidity-metrics",
            get(ai_liquidity_metrics),
        )
        .route("/api/v1/admin/operations", get(admin_operations))
        .route("/api/v1/admin/data-pipeline", get(admin_data_pipeline))
        .route("/api/v1/admin/tables/users", get(admin_table_users))
        .route("/api/v1/admin/tables/balances", get(admin_table_balances))
        .route(
            "/api/v1/admin/tables/open-calls",
            get(admin_table_open_calls),
        )
        .route(
            "/api/v1/admin/tables/settlements",
            get(admin_table_settlements),
        )
        .route(
            "/api/v1/admin/tables/prepaid-accounts",
            get(admin_table_prepaid_accounts),
        )
        .route(
            "/api/v1/admin/tables/dispute-events",
            get(admin_table_dispute_events),
        )
        .route("/api/v1/admin/disputes/{id}/review", post(review_dispute))
        .route(
            "/api/v1/admin/document-feedback",
            get(list_document_feedback),
        )
        .route(
            "/api/v1/admin/document-feedback/{id}/review",
            post(review_document_feedback),
        )
        .route("/api/v1/account-controls", get(account_controls))
        .route("/api/v1/account/balance", get(get_balance))
        .route("/api/v1/account/export", get(export_account))
        .route("/api/v1/account", delete(delete_account))
        .route("/api/v1/contributors/{handle}", get(contributor_manifest))
        // Compatibility aliases for PR #9's original public persona contract.
        // The canonical terminology is now "contributor".
        .route("/api/v1/personas/{handle}", get(persona_manifest))
        .route(
            "/api/v1/personas/{persona}/documents/{handle}",
            get(persona_document),
        )
        .route(
            "/api/v1/personas/{handle}/memories/{id}",
            get(persona_memory),
        )
        .route("/api/v1/documents/{handle}", get(public_document))
        .route("/api/v1/profile", get(get_profile).post(upsert_profile))
        .route("/api/v1/profile/preferences", post(update_preferences))
        .route(
            "/api/v1/profile/wallet/challenge",
            post(create_wallet_challenge),
        )
        .route("/api/v1/profile/wallet/verify", post(verify_wallet))
        .route("/api/v1/profile/wallet/siwx", post(create_wallet_siwx_link))
        .route(
            "/api/v1/profile/wallet/siwx/{id}",
            get(verify_wallet_siwx_link),
        )
        .route("/api/v1/prepaid/session", post(create_prepaid_session))
        .route("/api/v1/prepaid/balance", get(prepaid_balance))
        .route("/api/v1/prepaid/deposits", post(record_prepaid_deposit))
        .route(
            "/api/v1/payment-bundles/{id}",
            get(payment_bundle_quote_for_payer),
        )
        .route(
            "/api/v1/questions/{id}/settlement-invoice",
            post(settlement_invoice_preview),
        )
        .route(
            "/api/v1/agent-payment-bundles/{id}",
            get(payment_bundle_quote_for_agent),
        )
        .route(
            "/api/v1/agent-payment-quotes/{query_id}/{handle}",
            get(payment_quote_for_agent),
        )
        .route(
            "/api/v1/agent-payment-recoveries/{id}",
            get(recover_agent_payment_quote),
        )
        .route(
            "/api/v1/prepaid/withdrawals",
            post(create_prepaid_withdrawal),
        )
        .route("/api/v1/earnings", get(get_earnings))
        .route("/api/v1/payout-claims", get(list_payout_claims))
        .route(
            "/api/v1/questions/{query_id}/pay-sh-resources/{handle}",
            get(pay_sh_resource),
        )
        .route(
            "/api/v1/questions/{query_id}/pay-sh-documents/{handle}",
            get(recover_pay_sh_document),
        )
        .route(
            "/api/v1/pay-sh/documents/{price_krw}/{query_id}/{handle}",
            get(open_legacy_pay_sh_document),
        )
        .route(
            "/api/v2/pay-sh/documents/{price_krw}/{query_id}/{handle}",
            get(open_pay_sh_document),
        )
        .route("/api/flash-research", get(open_documents))
        .route(
            "/internal/v1/payment-quotes/{query_id}/{handle}",
            get(payment_quote),
        )
        .route(
            "/internal/v1/payment-quotes/{id}/document",
            get(paid_document),
        )
        .route(
            "/internal/v1/payment-quotes/{id}/snapshot",
            get(payment_document_snapshot),
        )
        .route(
            "/internal/v1/x402-payment-quotes/{id}",
            get(x402_payment_quote_by_id),
        )
        .route("/internal/v1/pay-sh-quotes/{id}", get(pay_sh_quote_by_id))
        .route(
            "/internal/v1/pay-sh-challenges/bind",
            post(bind_pay_sh_challenges),
        )
        .route(
            "/internal/v1/chain-settlements",
            post(record_chain_settlement),
        )
        .route("/internal/v1/payment-attempts", post(claim_payment_attempt))
        .route(
            "/internal/v1/payment-attempts/reconciliation",
            get(payment_attempt_reconciliations).post(defer_payment_attempt_reconciliation),
        )
        .route(
            "/internal/v1/payment-attempts/reconciliation/release",
            post(release_reconciled_payment_attempt),
        )
        .route("/internal/v1/payment-attempts/{id}", get(payment_attempt))
        .route(
            "/internal/v1/payment-attempts/release",
            post(release_payment_attempt),
        )
        .route("/internal/v1/payment-bundles", post(create_payment_bundle))
        .route(
            "/internal/v1/agent-payment-bundles",
            post(create_agent_payment_bundle),
        )
        .route(
            "/internal/v1/payment-bundles/{id}",
            get(payment_bundle_quote),
        )
        .route(
            "/internal/v1/payment-bundles/{id}/snapshot",
            get(payment_bundle_snapshot),
        )
        .route(
            "/internal/v1/bundle-chain-settlements",
            post(record_bundle_chain_settlement),
        )
        .route("/api/v1/research-jobs/{id}", get(research_job_status))
        .route(
            "/internal/v1/research-jobs/runnable",
            get(runnable_research_jobs),
        )
        .route(
            "/internal/v1/research-jobs/{id}/plan",
            get(research_job_plan),
        )
        .route(
            "/internal/v1/research-jobs/{id}/payment-attempts",
            post(begin_research_payment),
        )
        .route(
            "/internal/v1/research-payment-attempts/reconciliation",
            get(research_payment_reconciliations),
        )
        .route(
            "/internal/v1/research-jobs/{id}/payment-attempts/{attempt_id}/prepare",
            post(prepare_research_payment),
        )
        .route(
            "/internal/v1/research-jobs/{id}/payment-attempts/{attempt_id}/defer",
            post(defer_research_payment),
        )
        .route(
            "/internal/v1/research-jobs/{id}/payment-attempts/{attempt_id}/settle",
            post(settle_research_payment),
        )
        .route(
            "/internal/v1/research-jobs/{id}/payment-attempts/{attempt_id}/release",
            post(release_research_payment),
        )
        .route(
            "/internal/v1/direct-pay-sh-attempts/{attempt_id}/prepare",
            post(prepare_direct_pay_sh_payment),
        )
        .route(
            "/internal/v1/direct-pay-sh-attempts/reconciliation",
            get(direct_pay_sh_payment_reconciliations),
        )
        .route(
            "/internal/v1/direct-pay-sh-attempts/{attempt_id}/defer",
            post(defer_direct_pay_sh_payment),
        )
        .route(
            "/internal/v1/direct-pay-sh-attempts/{attempt_id}/settle",
            post(settle_direct_pay_sh_payment),
        )
        .route(
            "/internal/v1/direct-pay-sh-attempts/{attempt_id}/release",
            post(release_direct_pay_sh_payment),
        )
        .route(
            "/internal/v1/research-jobs/{id}/complete",
            post(complete_research_job),
        )
        .route(
            "/internal/v1/research-jobs/{id}/fail",
            post(fail_research_job),
        )
        .route(
            "/internal/v1/research-jobs/{id}/hold",
            post(hold_research_job),
        )
        .route(
            "/internal/v1/open-call-funding-quotes/{id}",
            get(open_call_funding_quote),
        )
        .route(
            "/internal/v1/open-call-funding-quotes/{id}/snapshot",
            get(open_call_funding_snapshot),
        )
        .route(
            "/internal/v1/open-call-chain-settlements",
            post(record_open_call_chain_settlement),
        )
        .route(
            "/internal/v1/payout-claims/backlog",
            get(payout_claim_backlog),
        )
        .route(
            "/internal/v1/payout-claims/lease",
            post(lease_payout_claims),
        )
        .route(
            "/internal/v1/payout-claims/{id}/prepare",
            post(prepare_payout_claim),
        )
        .route(
            "/internal/v1/payout-claims/{id}/complete",
            post(complete_payout_claim),
        )
        .route(
            "/internal/v1/payout-claims/{id}/fail",
            post(fail_payout_claim),
        );
    if email_password_auth_enabled {
        router = router
            .route("/api/v1/auth/register", post(register))
            .route("/api/v1/auth/login", post(login))
            .route("/api/v1/auth/password/forgot", post(forgot_password))
            .route("/api/v1/auth/password/reset", post(reset_password));
    }
    router.with_state(state)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        environment: None,
        auth_mode: None,
    })
}

async fn ready(State(state): State<Arc<AppState>>) -> Result<Json<HealthResponse>, ApiError> {
    if let Err(error) = state.store.ready() {
        tracing::error!(%error, "backend readiness invariant failed");
        return Err(ApiError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "not_ready",
            message: "service recovery state is not ready".to_owned(),
        });
    }
    Ok(Json(HealthResponse {
        status: "ready",
        environment: Some(state.environment.clone()),
        auth_mode: Some(if state.email_password_auth_enabled {
            "wallet-and-email"
        } else {
            "wallet-only"
        }),
    }))
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if reserved_wallet_email(&request.email) {
        return Err(ApiError::validation("use wallet sign in for this account"));
    }
    if !request.age_confirmed_14 {
        return Err(ApiError::validation(
            "you must confirm that you are at least 14 years old",
        ));
    }
    validate_password(&request.password)?;
    let password_hash = hash_password(&request.password)?;
    let user = state.store.register_user(&request.email, &password_hash)?;
    session_response(&state, user, StatusCode::CREATED)
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if reserved_wallet_email(&request.email) {
        return Err(ApiError::unauthorized(
            "use wallet sign in for this account",
        ));
    }
    state.store.check_login_allowed(&request.email)?;
    let (record, known_user) = match state.store.password_record(&request.email) {
        Ok(record) => (Some(record), true),
        Err(StoreError::Unauthorized(_)) => (None, false),
        Err(error) => return Err(error.into()),
    };
    let password_hash = record
        .as_ref()
        .map(|(_, password_hash)| password_hash.as_str())
        .unwrap_or(DUMMY_PASSWORD_HASH);
    let parsed = PasswordHash::new(password_hash).map_err(ApiError::internal)?;
    let password_valid = Argon2::default()
        .verify_password(request.password.as_bytes(), &parsed)
        .is_ok();
    if !known_user || !password_valid {
        state.store.record_login_failure(&request.email)?;
        return Err(ApiError::unauthorized("invalid email or password"));
    }
    let (user, _) = record.expect("known login record was loaded");
    state.store.clear_login_failures(&request.email)?;
    session_response(&state, user, StatusCode::OK)
}

async fn create_wallet_auth_challenge(
    State(state): State<Arc<AppState>>,
    Json(request): Json<WalletAuthChallengeRequest>,
) -> Result<(StatusCode, HeaderMap, Json<WalletAuthChallenge>), ApiError> {
    state.store.wallet_challenge_rate_limited(&request.wallet)?;
    let challenge = state.store.create_wallet_auth_challenge(
        &request.wallet,
        &random_token(),
        &state.frontend_origin,
        5 * 60 * 1_000,
        request.purpose,
        &state.payment_policy,
    )?;
    state.store.note_wallet_challenge_attempt(&request.wallet)?;
    Ok((
        StatusCode::CREATED,
        private_no_store_headers(),
        Json(challenge),
    ))
}

async fn verify_wallet_auth(
    State(state): State<Arc<AppState>>,
    Json(request): Json<WalletAuthVerifyRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let wallet = request.wallet.trim();
    state.store.wallet_challenge_rate_limited(wallet)?;
    if let Err(error) = state.store.consume_wallet_auth_challenge(
        wallet,
        &request.challenge_id,
        &request.signature,
        WalletChallengePurpose::WalletLoginV1,
    ) {
        state.store.note_wallet_challenge_attempt(wallet)?;
        return Err(error.into());
    }
    state.store.clear_wallet_challenge_attempts(wallet)?;

    let mut created = false;
    let user = if let Some(user) = state.store.wallet_identity(wallet)? {
        user
    } else if let Some(user) = state.store.verified_profile_owner(wallet)? {
        state.store.bind_wallet_identity(&user.id, wallet)?;
        user
    } else {
        if !request.age_confirmed_14 {
            return Err(ApiError::validation(
                "confirm that you are at least 14 years old to create this wallet account",
            ));
        }
        let email = format!("{}@wallet.obolus.local", token_hash(wallet));
        let (user, was_created) =
            state
                .store
                .create_wallet_identity_user(wallet, &email, WALLET_ONLY_PASSWORD_MARKER)?;
        created = was_created;
        user
    };
    session_response(
        &state,
        user,
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
    )
}

async fn create_wallet_auth_siwx_link(
    State(state): State<Arc<AppState>>,
    Json(request): Json<WalletAuthSiwxRequest>,
) -> Result<(StatusCode, HeaderMap, Json<WalletSiwxLink>), ApiError> {
    let id = random_token();
    let nonce = random_token();
    let resource_url = format!("{}/api/v1/auth/wallet/siwx/{id}", state.agent_api_origin);
    let parsed = reqwest::Url::parse(&resource_url).map_err(ApiError::internal)?;
    let domain = parsed
        .host_str()
        .ok_or_else(|| ApiError::internal("SIWX resource URL has no host"))?;
    let issued = OffsetDateTime::now_utc();
    let expiration = issued + TimeDuration::minutes(5);
    let issued_at = issued.format(&Rfc3339).map_err(ApiError::internal)?;
    let expiration_time = expiration.format(&Rfc3339).map_err(ApiError::internal)?;
    let challenge = state.store.create_wallet_auth_siwx_challenge(
        &id,
        domain,
        &resource_url,
        "Sign in to Obulus with this local Pay.sh wallet. This signature spends no funds.",
        &nonce,
        &issued_at,
        &expiration_time,
        &state.payment_policy.network,
        request.age_confirmed_14,
        5 * 60 * 1_000,
    )?;
    Ok((
        StatusCode::CREATED,
        private_no_store_headers(),
        Json(WalletSiwxLink {
            id,
            resource_url,
            network: challenge.network,
            expires_at: challenge.expires_at,
        }),
    ))
}

async fn verify_wallet_auth_siwx_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let challenge = state.store.wallet_auth_siwx_challenge(&id)?;
    if challenge.expires_at <= now_ms() {
        return Err(StoreError::Conflict(
            "this wallet sign-in SIWX challenge has expired".to_owned(),
        )
        .into());
    }
    if challenge.consumed_at.is_some() {
        return Err(StoreError::Conflict(
            "this wallet sign-in SIWX challenge has already been used".to_owned(),
        )
        .into());
    }
    let Some(header_value) = headers
        .get(HeaderName::from_static("sign-in-with-x"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let envelope = serde_json::json!({
            "x402Version": 2,
            "resource": {
                "url": challenge.uri.clone(),
                "description": "Sign in to Obulus with a local Pay.sh wallet",
                "mimeType": "application/json"
            },
            "accepts": [],
            "error": "sign_in_required",
            "extensions": {
                "sign-in-with-x": {
                    "info": {
                        "domain": challenge.domain,
                        "uri": challenge.uri.clone(),
                        "statement": challenge.statement,
                        "version": "1",
                        "nonce": challenge.nonce,
                        "issuedAt": challenge.issued_at,
                        "expirationTime": challenge.expiration_time,
                        "requestId": challenge.id,
                        "resources": [challenge.uri]
                    },
                    "supportedChains": [{
                        "chainId": challenge.network,
                        "type": "ed25519",
                        "signatureScheme": "siws"
                    }]
                }
            }
        });
        let encoded =
            BASE64_STANDARD.encode(serde_json::to_vec(&envelope).map_err(ApiError::internal)?);
        let mut response_headers = private_no_store_headers();
        response_headers.insert(header::VARY, HeaderValue::from_static("SIGN-IN-WITH-X"));
        response_headers.insert(
            HeaderName::from_static("payment-required"),
            HeaderValue::from_str(&encoded).map_err(ApiError::internal)?,
        );
        return Ok((
            StatusCode::PAYMENT_REQUIRED,
            response_headers,
            Json(envelope),
        )
            .into_response());
    };
    if header_value.len() > 16 * 1_024 {
        return Err(ApiError::unauthorized("wallet SIWX payload is too large"));
    }
    let payload_bytes = BASE64_STANDARD
        .decode(header_value)
        .map_err(|_| ApiError::unauthorized("wallet SIWX payload is invalid"))?;
    let payload: SiwxPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::unauthorized("wallet SIWX payload is invalid"))?;
    let (wallet, age_confirmed_14) = state
        .store
        .consume_wallet_auth_siwx_challenge(&id, &payload)?;

    let mut created = false;
    let user = if let Some(user) = state.store.wallet_identity(&wallet)? {
        user
    } else if let Some(user) = state.store.verified_profile_owner(&wallet)? {
        state.store.bind_wallet_identity(&user.id, &wallet)?;
        user
    } else {
        if !age_confirmed_14 {
            return Err(ApiError::validation(
                "confirm that you are at least 14 years old to create this wallet account",
            ));
        }
        let email = format!("{}@wallet.obolus.local", token_hash(&wallet));
        let (user, was_created) = state.store.create_wallet_identity_user(
            &wallet,
            &email,
            WALLET_ONLY_PASSWORD_MARKER,
        )?;
        created = was_created;
        user
    };
    let (session_token, balance, identity_wallet, expires_at) = issue_session(&state, &user)?;
    let wallet = identity_wallet.unwrap_or(wallet);
    let mut response_headers = private_no_store_headers();
    response_headers.insert(header::VARY, HeaderValue::from_static("SIGN-IN-WITH-X"));
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        response_headers,
        Json(AgentAuthResponse {
            user,
            balance,
            wallet,
            session_token,
            expires_at,
        }),
    )
        .into_response())
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ForgotPasswordRequest>,
) -> Result<StatusCode, ApiError> {
    if reserved_wallet_email(&request.email) {
        return Ok(StatusCode::NO_CONTENT);
    }
    let token = random_token();
    state.store.queue_password_reset(
        &request.email,
        &token_hash(&token),
        &token,
        &state.frontend_origin,
    )?;
    AppState::dispatch_pending_emails(Arc::clone(&state));
    Ok(StatusCode::NO_CONTENT)
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<StatusCode, ApiError> {
    validate_password(&request.password)?;
    if request.token.len() < 32 || request.token.len() > 256 {
        return Err(ApiError::unauthorized(
            "password reset link is invalid or expired",
        ));
    }
    let password_hash = hash_password(&request.password)?;
    state
        .store
        .reset_password(&token_hash(&request.token), &password_hash)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(token) = session_token(&headers) {
        let hash = token_hash(&token);
        if let Ok(user) = state.store.authenticate_session(&hash) {
            state.store.revoke_prepaid_sessions(&user.id)?;
        }
        state.store.revoke_session(&hash)?;
    }
    let mut response_headers = HeaderMap::new();
    response_headers.append(header::SET_COOKIE, expired_session_cookie(&state)?);
    response_headers.append(header::SET_COOKIE, expired_prepaid_cookie(&state)?);
    Ok((StatusCode::NO_CONTENT, response_headers))
}

async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AuthResponse>, ApiError> {
    let mut user = authenticated(&state, &headers)?;
    let balance = state.store.balance(&user.id)?;
    let wallet = state.store.identity_wallet(&user.id)?;
    // Report the effective role: an allowlisted wallet is admin even without a
    // persisted role write, so the client's admin surfaces light up.
    if user.role != "admin" && state.store.is_admin(&user.id)? {
        user.role = "admin".to_owned();
    }
    Ok(Json(AuthResponse {
        user,
        balance,
        wallet,
    }))
}

async fn resolve_question(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ResolveQuestionRequest>,
) -> Result<Json<ResolveQuestionResponse>, ApiError> {
    let question = request.question.clone();
    let agent_run_id = format!("agent_{}", random_token());
    let provider_fence =
        orchestrator::generation_fence_namespace(orchestrator::AGENT_PLAN_POLICY_VERSION);
    let input_hash = token_hash(
        &serde_json::to_string(&serde_json::json!({
            "providerFence": provider_fence,
            "question": &request.question,
            "requestedDocuments": request.requested_documents,
            "budgetKrw": request.budget_krw,
            "filters": &request.filters,
        }))
        .expect("agent plan input is serialisable"),
    );
    // Free discovery remains public and deterministic. Provider-backed
    // planning is enabled only for an authenticated account and is budgeted
    // per user, preventing an anonymous endpoint from becoming an unbounded
    // Vertex spend surface.
    let planner_scope = session_token(&headers).and_then(|token| {
        state
            .store
            .authenticate_session(&token_hash(&token))
            .ok()
            .map(|user| user.id)
    });
    let mut provider_window = None;
    if let Some(scope_id) = planner_scope.as_deref()
        && let AiGenerationClaim::Acquired { window_started_at } =
            state
                .store
                .claim_ai_generation("agent_plan", scope_id, &input_hash, &[])?
        && authorize_agent_model_call(
            &state,
            "agent_plan",
            scope_id,
            &input_hash,
            window_started_at,
            &provider_fence,
        )
        .await
        .is_ok()
    {
        provider_window = Some((scope_id.to_owned(), window_started_at));
    }
    let planned =
        orchestrator::plan_human_evidence_search(&request, provider_window.is_some()).await;
    if let Some((scope_id, window_started_at)) = provider_window {
        if planned.mode == "vertex_function_call" {
            state.store.complete_ai_generation(
                "agent_plan",
                &scope_id,
                &input_hash,
                window_started_at,
                None,
            )?;
        } else {
            state.store.fail_ai_generation(
                "agent_plan",
                &scope_id,
                &input_hash,
                window_started_at,
            )?;
        }
    }
    let resolver =
        Resolver::new(state.store.documents()?).with_evidence_edges(state.store.evidence_edges()?);
    let trace_instance = gemini_mcp_instance(&headers);
    let mut trace_checkpoint = Instant::now();
    let mut response = resolver.resolve_with_observer(planned.request.clone(), |checkpoint| {
        let Some(instance) = trace_instance.as_deref() else {
            return;
        };
        let (stage, action) = match checkpoint {
            ResolveTraceStage::QueryIndexed => ("index", "query_indexed"),
            ResolveTraceStage::AuthorityRanked => ("authority", "pagerank_computed"),
            ResolveTraceStage::CandidatesSelected => ("retrieval", "candidates_selected"),
            ResolveTraceStage::CoverageDecided => ("result", "coverage_decided"),
        };
        let latency_ms = trace_checkpoint
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        trace_checkpoint = Instant::now();
        if let Err(error) =
            state.record_system_event("gemini-mcp", instance, stage, action, 200, latency_ms)
        {
            tracing::warn!(%error, stage, action, "could not persist Gemini MCP resolver checkpoint");
        }
    })?;
    let query_id = response.query_id.clone();
    let action_provider_fence =
        orchestrator::generation_fence_namespace(orchestrator::AGENT_ACTION_POLICY_VERSION);
    let action_input_hash = token_hash(
        &serde_json::to_string(&serde_json::json!({
            "providerFence": action_provider_fence,
            "queryId": &query_id,
            "decision": response.decision,
            "reason": response.reason,
            "liquidityState": response.liquidity_state,
            "requestedDocuments": response.requested_documents,
            "candidateCount": response.candidate_count,
            "selectedDocumentCount": response.matches.len(),
            "quoteAvailable": response.quote.is_some(),
        }))
        .expect("agent next-action input is serialisable"),
    );
    let mut action_provider_window = None;
    if let Some(scope_id) = planner_scope.as_deref()
        && let AiGenerationClaim::Acquired { window_started_at } =
            state
                .store
                .claim_ai_generation("agent_plan", scope_id, &action_input_hash, &[])?
        && authorize_agent_model_call(
            &state,
            "agent_plan",
            scope_id,
            &action_input_hash,
            window_started_at,
            &action_provider_fence,
        )
        .await
        .is_ok()
    {
        action_provider_window = Some((scope_id.to_owned(), window_started_at));
    }
    let next =
        orchestrator::plan_next_market_action(&response, action_provider_window.is_some()).await;
    if let Some((scope_id, window_started_at)) = action_provider_window {
        if next.mode == "vertex_function_call" {
            state.store.complete_ai_generation(
                "agent_plan",
                &scope_id,
                &action_input_hash,
                window_started_at,
                None,
            )?;
        } else {
            state.store.fail_ai_generation(
                "agent_plan",
                &scope_id,
                &action_input_hash,
                window_started_at,
            )?;
        }
    }
    let mut steps = vec![planned.step];
    steps.push(AgentStep {
        sequence: 2,
        agent: "retrieval_agent".to_owned(),
        tool: AgentTool::RankEvidenceBundle,
        status: AgentStepStatus::Completed,
        summary: format!(
            "Ranked {} eligible candidates and selected {} independent documents within policy.",
            response.candidate_count,
            response.matches.len()
        ),
        artifact_ref: Some(query_id.clone()),
    });
    steps.push(next.step);
    let mode = match (planned.mode.as_str(), next.mode.as_str()) {
        ("vertex_function_call", "vertex_function_call") => {
            "vertex_two_stage_with_deterministic_guards"
        }
        ("vertex_function_call", _) | (_, "vertex_function_call") => {
            "partial_vertex_with_deterministic_fallback"
        }
        _ => "deterministic_fallback",
    };
    let model = if planned.model != "none" {
        planned.model
    } else {
        next.model
    };
    let provider_call_count = usize::from(planned.mode == "vertex_function_call")
        + usize::from(next.mode == "vertex_function_call");
    let runtime_revision = std::env::var("K_REVISION")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let agent_run = AgentRun {
        id: agent_run_id,
        objective: "Find the smallest trustworthy human-evidence set, then choose the next safe market action."
            .to_owned(),
        model,
        mode: mode.to_owned(),
        provider_call_count,
        runtime_revision: runtime_revision.clone(),
        steps,
        next_action: next.tool,
        requires_user_approval: matches!(
            next.tool,
            AgentTool::ProposeEvidencePurchase
                | AgentTool::ProposeHybridResearch
                | AgentTool::ProposeOpenCall
        ),
    };
    tracing::info!(
        agent_run_id = %agent_run.id,
        query_id = %query_id,
        runtime_revision = runtime_revision.as_deref().unwrap_or("local"),
        provider_call_count,
        mode,
        model = %agent_run.model,
        "bounded research run completed"
    );
    response.agent_run = Some(agent_run);
    let payment_access_token = random_token();
    state.store.record_resolution(
        &question,
        &response,
        Some(&token_hash(&payment_access_token)),
    )?;
    response.payment_access_token = Some(payment_access_token);
    Ok(Json(response))
}

/// Only the installed Gemini CLI MCP gets fine-grained execution telemetry.
/// Requiring its per-tool-call instance suffix prevents a browser or an older
/// static client label from making the observatory appear live.
fn gemini_mcp_instance(headers: &HeaderMap) -> Option<String> {
    let client = headers.get("x-obulus-client")?.to_str().ok()?.trim();
    let instance = headers.get("x-obulus-instance")?.to_str().ok()?.trim();
    (client == "gemini-mcp"
        && instance.starts_with("gemini-cli-")
        && instance.len() <= 64
        && instance
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    .then(|| instance.to_owned())
}

async fn authorize_model_call(
    state: &AppState,
    operation: &str,
    scope_id: &str,
    input_hash: &str,
    window_started_at: u64,
    provider_fence: &str,
) -> Result<(), ApiError> {
    let intent = ModelCallAuditIntent::new(
        operation,
        scope_id,
        input_hash,
        window_started_at,
        provider_fence,
    )
    .map_err(ApiError::service_unavailable)?;
    if let Err(audit_error) = state.rollback_audit.persist_model_call(&intent).await {
        if let Err(release_error) = state.store.release_ai_generation_before_provider(
            operation,
            scope_id,
            input_hash,
            window_started_at,
        ) {
            tracing::error!(
                error = %release_error,
                operation,
                "provider claim could not be released after rollback-audit failure"
            );
        }
        return Err(ApiError::service_unavailable(audit_error));
    }
    Ok(())
}

/// A resolve request performs two sequential audit + provider stages under the
/// router's 22-second deadline. Each audit gets a tighter budget so a slow GCS
/// write degrades to deterministic policy instead of consuming the whole
/// request. A timed-out claim is explicitly released before returning.
async fn authorize_agent_model_call(
    state: &AppState,
    operation: &str,
    scope_id: &str,
    input_hash: &str,
    window_started_at: u64,
    provider_fence: &str,
) -> Result<(), ApiError> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        authorize_model_call(
            state,
            operation,
            scope_id,
            input_hash,
            window_started_at,
            provider_fence,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            state.store.release_ai_generation_before_provider(
                operation,
                scope_id,
                input_hash,
                window_started_at,
            )?;
            Err(ApiError::service_unavailable(
                "model-call audit exceeded the bounded planning deadline",
            ))
        }
    }
}

async fn generate_ai_baseline(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(query_id): Path<String>,
) -> Result<Json<GenerateAiBaselineResponse>, ApiError> {
    let access_token = query_access_token(&headers)?;
    let access_token_hash = token_hash(access_token);
    let (question, cached) = state
        .store
        .ai_baseline_context(&query_id, &access_token_hash)?;
    if let Some(baseline) = cached {
        return Ok(Json(GenerateAiBaselineResponse {
            status: "cached",
            baseline: Some(baseline),
        }));
    }

    let public_evidence = state.store.public_evidence(Some(&question), 6)?;

    let provider_fence =
        orchestrator::generation_fence_namespace(orchestrator::AI_BASELINE_POLICY_VERSION);
    let input_hash = token_hash(
        &serde_json::to_string(&serde_json::json!({
            "providerFence": provider_fence,
            "queryId": query_id,
            "question": question,
            "publicEvidence": public_evidence.iter().map(|record| (&record.id, &record.content_hash)).collect::<Vec<_>>(),
        }))
        .expect("AI baseline input is serialisable"),
    );
    let window_started_at =
        match state
            .store
            .claim_ai_generation("baseline", &query_id, &input_hash, &[])?
        {
            AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            AiGenerationClaim::Cached(_) | AiGenerationClaim::Suppressed => {
                let (_, cached) = state
                    .store
                    .ai_baseline_context(&query_id, &access_token_hash)?;
                return Ok(Json(GenerateAiBaselineResponse {
                    status: if cached.is_some() {
                        "cached"
                    } else {
                        "unavailable"
                    },
                    baseline: cached,
                }));
            }
        };

    authorize_model_call(
        &state,
        "baseline",
        &query_id,
        &input_hash,
        window_started_at,
        &provider_fence,
    )
    .await?;

    let generated = match orchestrator::generate_ai_baseline(&question, &public_evidence).await {
        Ok(generated) => generated,
        Err(error) => {
            state.store.fail_ai_generation(
                "baseline",
                &query_id,
                &input_hash,
                window_started_at,
            )?;
            return Err(ApiError::validation(&error.to_string()));
        }
    };
    let Some(generated) = generated else {
        state
            .store
            .fail_ai_generation("baseline", &query_id, &input_hash, window_started_at)?;
        return Ok(Json(GenerateAiBaselineResponse {
            status: "unavailable",
            baseline: None,
        }));
    };
    let baseline = state.store.record_ai_baseline(
        &query_id,
        &access_token_hash,
        &generated.draft,
        &generated.sources,
        &AiArtifactMetadata {
            model: &generated.model,
            mode: &generated.mode,
            policy_version: orchestrator::AI_BASELINE_POLICY_VERSION,
            ttl_ms: state.ai_baseline_ttl_ms,
        },
    )?;
    state.store.complete_ai_generation(
        "baseline",
        &query_id,
        &input_hash,
        window_started_at,
        None,
    )?;
    Ok(Json(GenerateAiBaselineResponse {
        status: "generated",
        baseline: Some(baseline),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicEvidenceQuery {
    q: Option<String>,
    limit: Option<usize>,
}

async fn list_public_evidence(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PublicEvidenceQuery>,
) -> Result<Json<Vec<PublicEvidenceRecord>>, ApiError> {
    Ok(Json(state.store.public_evidence(
        query.q.as_deref(),
        query.limit.unwrap_or(12),
    )?))
}

async fn list_shelf_starters(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ShelfStarter>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.list_shelf_starters(&user.id)?))
}

async fn generate_shelf_starters(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<GenerateShelfStartersResponse>, ApiError> {
    let user = authenticated(&state, &headers)?;
    let existing = state.store.list_shelf_starters(&user.id)?;
    if !existing.is_empty() {
        return Ok(Json(GenerateShelfStartersResponse {
            status: "cached",
            starters: existing,
        }));
    }
    let profile = state.store.get_profile(&user.id)?.ok_or_else(|| {
        StoreError::Conflict("complete onboarding before building your database".to_owned())
    })?;
    let mut categories = profile.speaks_to.clone();
    categories.sort_unstable();
    categories.dedup();
    let provider_fence =
        orchestrator::generation_fence_namespace(orchestrator::SHELF_STARTER_POLICY_VERSION);
    let input_hash = token_hash(
        &serde_json::to_string(&serde_json::json!({
            "providerFence": provider_fence,
            "field": profile.field,
            "categories": categories,
        }))
        .expect("shelf starter input is serialisable"),
    );
    let window_started_at =
        match state
            .store
            .claim_ai_generation("shelf_starters", &user.id, &input_hash, &[])?
        {
            AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            AiGenerationClaim::Cached(_) | AiGenerationClaim::Suppressed => {
                let existing = state.store.list_shelf_starters(&user.id)?;
                return Ok(Json(GenerateShelfStartersResponse {
                    status: if existing.is_empty() {
                        "unavailable"
                    } else {
                        "cached"
                    },
                    starters: existing,
                }));
            }
        };
    authorize_model_call(
        &state,
        "shelf_starters",
        &user.id,
        &input_hash,
        window_started_at,
        &provider_fence,
    )
    .await?;
    let generated =
        match orchestrator::generate_shelf_starters(&profile.field, &profile.speaks_to).await {
            Ok(generated) => generated,
            Err(error) => {
                state.store.fail_ai_generation(
                    "shelf_starters",
                    &user.id,
                    &input_hash,
                    window_started_at,
                )?;
                return Err(ApiError::validation(&error.to_string()));
            }
        };
    let Some(generated) = generated else {
        state.store.fail_ai_generation(
            "shelf_starters",
            &user.id,
            &input_hash,
            window_started_at,
        )?;
        return Ok(Json(GenerateShelfStartersResponse {
            status: "unavailable",
            starters: Vec::new(),
        }));
    };
    let starters = state.store.record_shelf_starters(
        &user.id,
        &generated.starters,
        &generated.model,
        &generated.mode,
        orchestrator::SHELF_STARTER_POLICY_VERSION,
        24 * 60 * 60 * 1_000,
    )?;
    state.store.complete_ai_generation(
        "shelf_starters",
        &user.id,
        &input_hash,
        window_started_at,
        None,
    )?;
    Ok(Json(GenerateShelfStartersResponse {
        status: "generated",
        starters,
    }))
}

async fn submit_shelf_starter_answer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(starter_id): Path<String>,
    Json(request): Json<SubmitShelfStarterAnswerRequest>,
) -> Result<(StatusCode, Json<SubmitShelfStarterAnswerResponse>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let response = state.store.submit_shelf_starter_answer(
        &user.id,
        &starter_id,
        &request.answer,
        request.price_krw,
    )?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn synthesize_answer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<SynthesizePaidAnswerRequest>,
) -> Result<(HeaderMap, Json<SynthesizeAnswerResponse>), ApiError> {
    let access_token = query_access_token(&headers)?;
    let (question, citations) = state.store.opened_evidence(
        &request.query_id,
        &request.handles,
        &token_hash(access_token),
    )?;
    let persona_databases = state
        .store
        .persona_databases_for_documents(&request.handles)?;
    let canonical_request = SynthesizeAnswerRequest {
        query_id: request.query_id.clone(),
        question,
        citations,
        persona_databases,
    };
    let provider_fence =
        orchestrator::generation_fence_namespace(orchestrator::PAID_SYNTHESIS_POLICY_VERSION);
    let input_hash = token_hash(
        &serde_json::to_string(&serde_json::json!({
            "providerFence": provider_fence,
            "request": canonical_request,
        }))
        .expect("canonical synthesis input is serialisable"),
    );
    let synthesis_handles = canonical_request
        .citations
        .iter()
        .map(|citation| citation.handle.clone())
        .collect::<Vec<_>>();
    let window_started_at = match state.store.claim_ai_generation(
        "synthesis",
        &request.query_id,
        &input_hash,
        &synthesis_handles,
    )? {
        AiGenerationClaim::Acquired { window_started_at } => window_started_at,
        AiGenerationClaim::Cached(response_json) => {
            let response = serde_json::from_str::<SynthesizeAnswerResponse>(&response_json)
                .map_err(|_| {
                    StoreError::Conflict(
                        "durable synthesis response is malformed; stop provider calls and reconcile"
                            .to_owned(),
                    )
                })?;
            state
                .store
                .record_contributions(&request.query_id, &response.contributions)?;
            return Ok((private_no_store_headers(), Json(response)));
        }
        AiGenerationClaim::Suppressed => {
            return Ok((
                private_no_store_headers(),
                Json(orchestrator::fallback(&canonical_request)),
            ));
        }
    };
    authorize_model_call(
        &state,
        "synthesis",
        &request.query_id,
        &input_hash,
        window_started_at,
        &provider_fence,
    )
    .await?;
    let response = match orchestrator::synthesize(&canonical_request).await {
        Ok(response) => response,
        Err(error) => {
            state.store.fail_ai_generation(
                "synthesis",
                &request.query_id,
                &input_hash,
                window_started_at,
            )?;
            return Err(ApiError::validation(&error.to_string()));
        }
    };
    if response.mode == "evidence_only_fallback" {
        state.store.fail_ai_generation(
            "synthesis",
            &request.query_id,
            &input_hash,
            window_started_at,
        )?;
        return Ok((private_no_store_headers(), Json(response)));
    }
    let response_json = serde_json::to_string(&response)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    state.store.complete_ai_generation(
        "synthesis",
        &request.query_id,
        &input_hash,
        window_started_at,
        Some(&response_json),
    )?;
    state
        .store
        .record_contributions(&request.query_id, &response.contributions)?;
    Ok((private_no_store_headers(), Json(response)))
}

async fn payment_progress(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PayerQuery>,
) -> Result<Json<PaymentProgress>, ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok(Json(state.store.payment_progress(
        &id,
        &query.payer,
        &token_hash(access_token),
    )?))
}

async fn recover_paid_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
    Query(query): Query<PayerQuery>,
) -> Result<(HeaderMap, Json<RecoveredPaidDocument>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.recover_paid_document(
            &query_id,
            &handle,
            &query.payer,
            &token_hash(access_token),
        )?),
    ))
}

async fn submit_document_feedback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
    Query(query): Query<PayerQuery>,
    Json(request): Json<SubmitDocumentFeedbackRequest>,
) -> Result<(StatusCode, Json<DocumentFeedback>), ApiError> {
    let access_token = query_access_token(&headers)?;
    let feedback = state.store.submit_document_feedback(
        &query_id,
        &handle,
        &query.payer,
        &token_hash(access_token),
        &request,
    )?;
    Ok((StatusCode::CREATED, Json(feedback)))
}

async fn list_open_calls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<OpenCall>>, ApiError> {
    let user = optional_authenticated(&state, &headers)?;
    Ok(Json(state.store.list_open_calls(
        user.as_ref().map(|user| user.id.as_str()),
    )?))
}

async fn create_open_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateOpenCallRequest>,
) -> Result<(StatusCode, Json<OpenCall>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let call = state
        .store
        .create_open_call(&user.id, &request, &state.payment_policy)?;
    AppState::dispatch_pending_emails(Arc::clone(&state));
    Ok((StatusCode::CREATED, Json(call)))
}

async fn create_open_call_funding_quote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateOpenCallRequest>,
) -> Result<(StatusCode, Json<OpenCallFundingQuote>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_open_call_funding_quote(
            &user.id,
            &request,
            &state.payment_policy,
        )?),
    ))
}

async fn open_call_funding_quote_for_owner(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<OpenCallFundingQuote>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(
        state
            .store
            .open_call_funding_quote_for_owner(&id, &user.id)?,
    ))
}

async fn reserve_open_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<OpenCallReservation>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.reserve_open_call(&id, &user.id)?),
    ))
}

async fn release_open_call_reservation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let user = authenticated(&state, &headers)?;
    state.store.release_open_call_reservation(&id, &user.id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ContributorNotification>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.list_notifications(&user.id)?))
}

async fn mark_notifications_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<MarkNotificationsReadRequest>,
) -> Result<StatusCode, ApiError> {
    let user = authenticated(&state, &headers)?;
    state
        .store
        .mark_notifications_read(&user.id, &request.ids)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn submit_answer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<SubmitAnswerRequest>,
) -> Result<(StatusCode, Json<SubmitAnswerResponse>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let response = state.store.submit_answer_with_interview(
        &id,
        &user.id,
        &request.answer,
        &request.interview_responses,
    )?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn cancel_open_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<OpenCall>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.cancel_open_call(&user.id, &id)?))
}

async fn ai_liquidity_metrics(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AiLiquidityMetrics>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.ai_liquidity_metrics(&user.id)?))
}

async fn admin_operations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AdminOperationsSnapshot>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.admin_operations_snapshot(&user.id)?))
}

async fn admin_data_pipeline(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AdminDataPipelineSnapshot>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.admin_data_pipeline_snapshot(
        &user.id,
        state.deployment_info(),
    )?))
}

/// Pagination for the admin table viewers. `limit` defaults to
/// [`ADMIN_TABLE_DEFAULT_PAGE`] and is hard-capped server-side at 100;
/// `offset` defaults to 0.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminTablePageQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

const ADMIN_TABLE_DEFAULT_PAGE: usize = 50;

/// Serve one paginated, authenticated, redacted page of a curated table. Shared
/// by every `/api/v1/admin/tables/*` route so the account gate, the pagination
/// defaults, and the redacted projection live in exactly one place.
async fn admin_table_page(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    table: AdminTable,
    query: AdminTablePageQuery,
) -> Result<Json<AdminTablePage>, ApiError> {
    let user = authenticated(state, headers)?;
    Ok(Json(state.store.admin_table_page(
        &user.id,
        table,
        query.limit.unwrap_or(ADMIN_TABLE_DEFAULT_PAGE),
        query.offset.unwrap_or(0),
    )?))
}

async fn admin_table_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::Users, query).await
}

async fn admin_table_balances(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::Balances, query).await
}

async fn admin_table_open_calls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::OpenCalls, query).await
}

async fn admin_table_settlements(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::Settlements, query).await
}

async fn admin_table_prepaid_accounts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::PrepaidAccounts, query).await
}

async fn admin_table_dispute_events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AdminTablePageQuery>,
) -> Result<Json<AdminTablePage>, ApiError> {
    admin_table_page(&state, &headers, AdminTable::DisputeEvents, query).await
}

async fn chat_answers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Vec<ChatAnswer>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.chat_answers(&user.id, &id)?))
}

async fn list_memory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<MemoryEntry>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.list_memory(&user.id)?))
}

async fn update_memory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<UpdateMemoryRequest>,
) -> Result<Json<MemoryEntry>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.set_memory_locked(
        &user.id,
        &id,
        request.locked,
    )?))
}

async fn correct_memory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<CorrectMemoryRequest>,
) -> Result<(StatusCode, Json<MemoryEntry>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.correct_memory(&user.id, &id, &request)?),
    ))
}

async fn submit_dispute(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<SubmitDisputeRequest>,
) -> Result<(StatusCode, Json<DisputeCase>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let dispute = state.store.submit_dispute(&id, &user.id, &request.reason)?;
    Ok((StatusCode::CREATED, Json(dispute)))
}

async fn my_dispute(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Option<DisputeCase>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.my_dispute(&user.id)?))
}

async fn list_disputes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<DisputeCase>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.list_disputes(&user.id)?))
}

async fn create_evidence_edge(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateEvidenceEdgeRequest>,
) -> Result<(StatusCode, Json<EvidenceEdge>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_evidence_edge(&user.id, &request)?),
    ))
}

async fn review_dispute(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ReviewDisputeRequest>,
) -> Result<Json<DisputeCase>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.review_dispute(&user.id, &id, &request)?))
}

async fn list_document_feedback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<DocumentFeedback>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.list_document_feedback(&user.id)?))
}

async fn review_document_feedback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ReviewDocumentFeedbackRequest>,
) -> Result<Json<DocumentFeedback>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(
        state
            .store
            .review_document_feedback(&user.id, &id, &request)?,
    ))
}

async fn account_controls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AccountControls>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.account_controls(&user.id)?))
}

async fn get_balance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<BalanceSummary>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.balance(&user.id)?))
}

async fn export_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<MemoryExport>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.export_account(&user.id)?))
}

async fn contributor_manifest(
    State(state): State<Arc<AppState>>,
    Path(handle): Path<String>,
) -> Result<(HeaderMap, Json<ContributorManifest>), ApiError> {
    Ok((
        public_manifest_headers(),
        Json(state.store.contributor_manifest(&handle)?),
    ))
}

async fn persona_manifest(
    State(state): State<Arc<AppState>>,
    Path(handle): Path<String>,
) -> Result<(HeaderMap, Json<ContributorManifest>), ApiError> {
    contributor_manifest(State(state), Path(handle)).await
}

async fn persona_document(
    State(state): State<Arc<AppState>>,
    Path((persona, handle)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<PublicDocument>), ApiError> {
    let document = state.store.public_document(&handle)?;
    if !document
        .contributor_handle
        .as_deref()
        .is_some_and(|owner| owner.eq_ignore_ascii_case(&persona))
    {
        return Err(StoreError::NotFound("persona document").into());
    }
    Ok((public_manifest_headers(), Json(document)))
}

async fn persona_memory(
    State(state): State<Arc<AppState>>,
    Path((handle, id)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<ContributorMemoryLink>), ApiError> {
    let manifest = state.store.contributor_manifest(&handle)?;
    let memory = manifest
        .memories
        .into_iter()
        .find(|memory| memory.id == id)
        .ok_or(StoreError::NotFound("persona memory"))?;
    Ok((public_manifest_headers(), Json(memory)))
}

async fn public_document(
    State(state): State<Arc<AppState>>,
    Path(handle): Path<String>,
) -> Result<(HeaderMap, Json<PublicDocument>), ApiError> {
    Ok((
        public_manifest_headers(),
        Json(state.store.public_document(&handle)?),
    ))
}

async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = authenticated(&state, &headers)?;
    state.store.delete_account(&user.id)?;
    let mut response_headers = HeaderMap::new();
    response_headers.append(header::SET_COOKIE, expired_session_cookie(&state)?);
    response_headers.append(header::SET_COOKIE, expired_prepaid_cookie(&state)?);
    Ok((StatusCode::NO_CONTENT, response_headers))
}

async fn get_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Option<UserProfile>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.get_profile(&user.id)?))
}

async fn upsert_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpsertProfileRequest>,
) -> Result<Json<UserProfile>, ApiError> {
    let user = authenticated(&state, &headers)?;
    let profile = state.store.upsert_profile(&user.id, &request)?;
    AppState::dispatch_pending_emails(Arc::clone(&state));
    Ok(Json(profile))
}

async fn update_preferences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpdatePreferencesRequest>,
) -> Result<Json<UserProfile>, ApiError> {
    let user = authenticated(&state, &headers)?;
    let profile = state.store.update_preferences(&user.id, &request)?;
    AppState::dispatch_pending_emails(Arc::clone(&state));
    Ok(Json(profile))
}

async fn create_wallet_challenge(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<WalletChallengeRequest>,
) -> Result<(StatusCode, Json<WalletChallenge>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let challenge = state.store.create_wallet_challenge(
        &user.id,
        &request.wallet,
        &random_token(),
        5 * 60 * 1_000,
    )?;
    Ok((StatusCode::CREATED, Json(challenge)))
}

async fn verify_wallet(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<VerifyWalletRequest>,
) -> Result<Json<UserProfile>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.verify_wallet_challenge(
        &user.id,
        &request.challenge_id,
        &request.signature,
    )?))
}

async fn create_wallet_siwx_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<WalletSiwxLink>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let id = random_token();
    let nonce = random_token();
    let resource_url = format!("{}/api/v1/profile/wallet/siwx/{id}", state.agent_api_origin);
    let parsed = reqwest::Url::parse(&resource_url).map_err(ApiError::internal)?;
    let domain = parsed
        .host_str()
        .ok_or_else(|| ApiError::internal("SIWX resource URL has no host"))?;
    let issued = OffsetDateTime::now_utc();
    let expiration = issued + TimeDuration::minutes(5);
    let issued_at = issued.format(&Rfc3339).map_err(ApiError::internal)?;
    let expiration_time = expiration.format(&Rfc3339).map_err(ApiError::internal)?;
    let challenge = state.store.create_wallet_siwx_challenge(
        &user.id,
        &id,
        domain,
        &resource_url,
        "Verify this Pay.sh wallet as your Obulus payout wallet.",
        &nonce,
        &issued_at,
        &expiration_time,
        &state.payment_policy.network,
        5 * 60 * 1_000,
    )?;
    Ok((
        StatusCode::CREATED,
        Json(WalletSiwxLink {
            id,
            resource_url,
            network: challenge.network,
            expires_at: challenge.expires_at,
        }),
    ))
}

async fn verify_wallet_siwx_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let challenge = state.store.wallet_siwx_challenge(&id)?;
    if challenge.expires_at <= now_ms() {
        return Err(
            StoreError::Conflict("this wallet SIWX challenge has expired".to_owned()).into(),
        );
    }
    if challenge.consumed_at.is_some() {
        return Err(StoreError::Conflict(
            "this wallet SIWX challenge has already been used".to_owned(),
        )
        .into());
    }
    let Some(header_value) = headers
        .get(HeaderName::from_static("sign-in-with-x"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let envelope = serde_json::json!({
            "x402Version": 2,
            "resource": {
                "url": challenge.uri.clone(),
                "description": "Verify a Pay.sh wallet for Obulus contributor payouts",
                "mimeType": "application/json"
            },
            "accepts": [],
            "error": "sign_in_required",
            "extensions": {
                "sign-in-with-x": {
                    "info": {
                        "domain": challenge.domain,
                        "uri": challenge.uri.clone(),
                        "statement": challenge.statement,
                        "version": "1",
                        "nonce": challenge.nonce,
                        "issuedAt": challenge.issued_at,
                        "expirationTime": challenge.expiration_time,
                        "requestId": challenge.id,
                        "resources": [challenge.uri]
                    },
                    "supportedChains": [{
                        "chainId": challenge.network,
                        "type": "ed25519",
                        "signatureScheme": "siws"
                    }]
                }
            }
        });
        let encoded =
            BASE64_STANDARD.encode(serde_json::to_vec(&envelope).map_err(ApiError::internal)?);
        let mut response_headers = HeaderMap::new();
        response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response_headers.insert(header::VARY, HeaderValue::from_static("SIGN-IN-WITH-X"));
        response_headers.insert(
            HeaderName::from_static("payment-required"),
            HeaderValue::from_str(&encoded).map_err(ApiError::internal)?,
        );
        return Ok((
            StatusCode::PAYMENT_REQUIRED,
            response_headers,
            Json(envelope),
        )
            .into_response());
    };
    if header_value.len() > 16 * 1_024 {
        return Err(ApiError::unauthorized("wallet SIWX payload is too large"));
    }
    let payload_bytes = BASE64_STANDARD
        .decode(header_value)
        .map_err(|_| ApiError::unauthorized("wallet SIWX payload is invalid"))?;
    let payload: SiwxPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::unauthorized("wallet SIWX payload is invalid"))?;
    let profile = state.store.verify_wallet_siwx_challenge(&id, &payload)?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response_headers.insert(header::VARY, HeaderValue::from_static("SIGN-IN-WITH-X"));
    Ok((response_headers, Json(profile)).into_response())
}

async fn create_prepaid_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePrepaidSessionRequest>,
) -> Result<(StatusCode, HeaderMap, Json<PrepaidWalletSession>), ApiError> {
    let user = authenticated(&state, &headers)?;
    let wallet = request.wallet.trim().to_owned();
    state.store.wallet_challenge_rate_limited(&wallet)?;
    if let Err(error) = state.store.consume_wallet_auth_challenge(
        &wallet,
        &request.challenge_id,
        &request.signature,
        WalletChallengePurpose::PrepaidSpendV1,
    ) {
        state.store.note_wallet_challenge_attempt(&wallet)?;
        return Err(error.into());
    }
    state.store.clear_wallet_challenge_attempts(&wallet)?;
    let session = state.store.issue_prepaid_wallet_session(
        &user.id,
        &wallet,
        &random_token(),
        PREPAID_SESSION_TTL_MS,
        &state.payment_policy,
    )?;
    let mut cookie = format!(
        "{PREPAID_SESSION_COOKIE}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        session.token,
        PREPAID_SESSION_TTL_MS / 1_000
    );
    if state.secure_cookies {
        cookie.push_str("; Secure");
    }
    let mut response_headers = private_no_store_headers();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(ApiError::internal)?,
    );
    Ok((StatusCode::CREATED, response_headers, Json(session)))
}

async fn prepaid_balance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<PrepaidBalance>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        private_no_store_headers(),
        Json(
            state
                .store
                .prepaid_balance(&user.id, &state.payment_policy)?,
        ),
    ))
}

/// Records a facilitator-attested prepaid USDC top-up. Gated with
/// `require_internal` (Product Decision (e)): the pay.sh gateway posts here after
/// it verifies the Phantom-signed transfer on-chain, matching every other
/// chain-settlement record route. Idempotent by transaction signature.
async fn record_prepaid_deposit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RecordPrepaidDepositRequest>,
) -> Result<(HeaderMap, Json<PrepaidBalance>), ApiError> {
    require_internal(&state, &headers)?;
    // Only a genuine on-chain settlement may credit a prepaid balance. The
    // gateway is meant to verify the Phantom-signed transfer on-chain before
    // posting here, but nothing structurally stopped an internal caller from
    // crediting an unbacked balance with a synthetic reference id (the
    // `e2e-…`/`live-rec-…` top-ups that had to be reconciled away). Requiring the
    // reference to be a real base58 64-byte Solana signature closes that path:
    // it is the same shape `getTransaction`/`getSignatureStatuses` accept, and a
    // synthetic test id can never satisfy it.
    if !is_onchain_signature(&request.transaction_signature) {
        return Err(ApiError::validation(
            "transactionSignature must be a real on-chain Solana transaction signature",
        ));
    }
    let balance = state
        .store
        .record_prepaid_deposit(&request, &state.payment_policy)?;
    Ok((private_no_store_headers(), Json(balance)))
}

/// A real Solana transaction signature is a base58-encoded 64-byte Ed25519
/// signature. Used to keep synthetic/internal top-up ids from crediting a
/// prepaid balance as if they were on-chain-settled deposits.
fn is_onchain_signature(signature: &str) -> bool {
    bs58::decode(signature.trim())
        .into_vec()
        .map(|bytes| bytes.len() == 64)
        .unwrap_or(false)
}

async fn payment_bundle_quote_for_payer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<PaymentBundleQuote>), ApiError> {
    let access_token = query_access_token(&headers)?;
    let wallet_session = prepaid_session_token(&headers)
        .ok_or_else(|| ApiError::unauthorized("prepaid wallet session is required"))?;
    Ok((
        private_no_store_headers(),
        Json(state.store.payment_bundle_quote_for_payer(
            &id,
            &token_hash(access_token),
            &token_hash(&wallet_session),
        )?),
    ))
}

async fn payment_bundle_quote_for_agent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<PaymentBundleQuote>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(
            state
                .store
                .payment_bundle_quote_for_agent(&id, &token_hash(access_token))?,
        ),
    ))
}

async fn payment_quote_for_agent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<PaymentQuote>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.x402_payment_quote_for_agent(
            &query_id,
            &handle,
            &token_hash(access_token),
            &state.payment_policy,
        )?),
    ))
}

async fn create_prepaid_withdrawal(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePrepaidWithdrawalRequest>,
) -> Result<(StatusCode, Json<PayoutClaim>), ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_prepaid_withdrawal(
            &user.id,
            request.amount_atomic.as_deref(),
            &state.payment_policy,
        )?),
    ))
}

async fn get_earnings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<EarningsSummary>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.earnings(&user.id)?))
}

async fn list_payout_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<PayoutClaim>>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.payout_claims(&user.id)?))
}

async fn pay_sh_resource(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<PayShResource>), ApiError> {
    let access_token = query_access_token(&headers)?;
    if state.payment_policy.krw_per_usdc != PAY_SH_KRW_PER_USDC {
        return Err(ApiError::conflict(
            "Pay.sh price bands require OPENSHELF_KRW_PER_USDC=1350",
        ));
    }
    Ok((
        private_no_store_headers(),
        Json(state.store.pay_sh_resource(
            &query_id,
            &handle,
            &token_hash(access_token),
            &state.payment_policy,
        )?),
    ))
}

async fn recover_pay_sh_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<OpenDocumentsResponse>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(
            state
                .store
                .recover_pay_sh_document(&query_id, &handle, &token_hash(access_token))?,
        ),
    ))
}

async fn open_pay_sh_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((price_krw, query_id, handle)): Path<(u64, String, String)>,
    Query(query): Query<PayShDocumentQuery>,
) -> Result<(HeaderMap, Json<OpenDocumentsResponse>), ApiError> {
    // The official Pay.sh gateway strips the caller's payment credential and
    // injects this internal header only after it has verified the MPP charge.
    // A direct request to the Rust service therefore cannot release content.
    require_internal(&state, &headers)?;
    let access_token_hash = headers
        .get(QUERY_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(token_hash);
    let direct_payment_attempt_id = headers
        .get(DIRECT_PAY_ATTEMPT_HEADER)
        .and_then(|value| value.to_str().ok());
    if state.payment_policy.krw_per_usdc != PAY_SH_KRW_PER_USDC {
        return Err(ApiError::conflict(
            "Pay.sh price bands require OPENSHELF_KRW_PER_USDC=1350",
        ));
    }
    Ok((
        private_no_store_headers(),
        Json(state.store.open_pay_sh_document(PayShDeliveryRequest {
            query_id: &query_id,
            handle: &handle,
            path_price_krw: price_krw,
            owner_wallet: &query.owner_wallet,
            quote_id: &query.quote_id,
            payment_token_hash: access_token_hash.as_deref(),
            research_job_id: query.research_job_id.as_deref(),
            payment_attempt_id: query.payment_attempt_id.as_deref(),
            direct_payment_attempt_id,
            policy: &state.payment_policy,
        })?),
    ))
}

async fn open_legacy_pay_sh_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    path: Path<(u64, String, String)>,
    query: Query<PayShDocumentQuery>,
) -> Result<(HeaderMap, Json<OpenDocumentsResponse>), ApiError> {
    require_internal(&state, &headers)?;
    if !state.accept_legacy_pay_sh_callbacks {
        return Err(ApiError::gone(
            "legacy Pay.sh document URLs are retired; prepare a version 2 resource",
        ));
    }
    open_pay_sh_document(State(state), headers, path, query).await
}

async fn open_documents(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OpenDocumentsQuery>,
) -> Result<Json<OpenDocumentsResponse>, ApiError> {
    if !state.allow_demo_open {
        return Err(ApiError::forbidden(
            "demo opening is disabled; use the x402 gateway",
        ));
    }
    let handles = query
        .docs
        .split(',')
        .map(str::trim)
        .filter(|handle| !handle.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    Ok(Json(state.store.open_documents(
        &query.query_id,
        &handles,
        query.payer.as_deref(),
    )?))
}

async fn payment_quote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((query_id, handle)): Path<(String, String)>,
) -> Result<Json<PaymentQuote>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.x402_payment_quote(
        &query_id,
        &handle,
        &state.payment_policy,
    )?))
}

async fn paid_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<PaidDocument>), ApiError> {
    require_internal(&state, &headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.paid_document(&id)?),
    ))
}

async fn pay_sh_quote_by_id(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<PaymentQuote>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.payment_quote_by_id(&id)?))
}

async fn x402_payment_quote_by_id(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<PaymentQuote>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.x402_payment_quote_by_id(&id)?))
}

async fn recover_agent_payment_quote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<RecoveredPaidDocument>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(
            state
                .store
                .recover_paid_document_by_quote(&id, &token_hash(access_token))?,
        ),
    ))
}

async fn payment_document_snapshot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<PaymentDocumentSnapshot>), ApiError> {
    require_internal(&state, &headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.payment_document_snapshot(&id)?),
    ))
}

async fn record_chain_settlement(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RecordChainSettlementRequest>,
) -> Result<Json<ChainSettlementReceipt>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.record_chain_settlement(&request)?))
}

async fn claim_payment_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimPaymentAttemptRequest>,
) -> Result<Json<PaymentAttemptFence>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    RollbackAuditIntent::validate_chain_request(&request)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    let fence = state.store.claim_payment_attempt(&request)?;
    let reconciliation = state
        .store
        .payment_attempt_reconciliation(&fence.attempt_id)?;
    let intent =
        RollbackAuditIntent::chain(&reconciliation).map_err(ApiError::service_unavailable)?;
    state
        .rollback_audit
        .persist(&intent)
        .await
        .map_err(ApiError::service_unavailable)?;
    Ok(Json(fence))
}

async fn release_payment_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimPaymentAttemptRequest>,
) -> Result<Json<PaymentAttemptRelease>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    Ok(Json(state.store.release_payment_attempt(&request)?))
}

async fn payment_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<PaymentAttemptReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    Ok(Json(state.store.payment_attempt_reconciliation(&id)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentAttemptReconciliationQuery {
    limit: Option<usize>,
}

async fn payment_attempt_reconciliations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PaymentAttemptReconciliationQuery>,
) -> Result<Json<Vec<PaymentAttemptReconciliation>>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    Ok(Json(state.store.payment_attempt_reconciliations(
        query.limit.unwrap_or(25),
    )?))
}

async fn defer_payment_attempt_reconciliation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimPaymentAttemptRequest>,
) -> Result<Json<PaymentAttemptFence>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    Ok(Json(
        state.store.defer_payment_attempt_reconciliation(&request)?,
    ))
}

async fn release_reconciled_payment_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimPaymentAttemptRequest>,
) -> Result<Json<PaymentAttemptRelease>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    Ok(Json(
        state.store.release_reconciled_payment_attempt(&request)?,
    ))
}

async fn create_payment_bundle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePaymentBundleRequest>,
) -> Result<Json<PaymentBundleQuote>, ApiError> {
    require_internal(&state, &headers)?;
    let access_token = query_access_token(&headers)?;
    let wallet_session = headers
        .get(PREPAID_SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("prepaid wallet session is required"))?;
    Ok(Json(state.store.create_payment_bundle(
        &request,
        &token_hash(access_token),
        &token_hash(wallet_session),
        &state.payment_policy,
    )?))
}

async fn settlement_invoice_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<SettlementPreviewRequest>,
) -> Result<Json<crate::settlement_invoice::SettlementPreviewEnvelope>, ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok(Json(state.store.settlement_invoice_preview(
        &id,
        &token_hash(access_token),
        &request.handles,
        &state.payment_policy,
    )?))
}

async fn create_agent_payment_bundle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePaymentBundleRequest>,
) -> Result<Json<PaymentBundleQuote>, ApiError> {
    require_internal(&state, &headers)?;
    require_payment_protocol(&headers)?;
    let access_token = query_access_token(&headers)?;
    Ok(Json(state.store.create_agent_payment_bundle(
        &request,
        &token_hash(access_token),
        &state.payment_policy,
    )?))
}

async fn payment_bundle_quote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<PaymentBundleQuote>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.payment_bundle_quote(&id)?))
}

async fn payment_bundle_snapshot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<PaymentBundleSnapshot>), ApiError> {
    require_internal(&state, &headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.payment_bundle_snapshot(&id)?),
    ))
}

async fn record_bundle_chain_settlement(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RecordChainSettlementRequest>,
) -> Result<Json<ChainSettlementReceipt>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.record_bundle_chain_settlement(&request)?))
}

async fn research_job_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<ResearchJobStatus>), ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok((
        private_no_store_headers(),
        Json(
            state
                .store
                .research_job_status(&id, &token_hash(access_token))?,
        ),
    ))
}

async fn research_job_plan(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ResearchJobPlan>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(
        state.store.research_job_plan(&id, &state.payment_policy)?,
    ))
}

async fn runnable_research_jobs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.runnable_research_jobs(50)?))
}

async fn begin_research_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<BeginResearchPaymentRequest>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.begin_research_payment(&id, &request)?))
}

async fn prepare_research_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((id, attempt_id)): Path<(String, String)>,
    Json(request): Json<PrepareResearchPaymentRequest>,
) -> Result<Json<ResearchPaymentReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    let reconciliation = state
        .store
        .prepare_research_payment(&id, &attempt_id, &request)?;
    let intent =
        RollbackAuditIntent::research(&reconciliation).map_err(ApiError::service_unavailable)?;
    state
        .rollback_audit
        .persist(&intent)
        .await
        .map_err(ApiError::service_unavailable)?;
    Ok(Json(reconciliation))
}

async fn research_payment_reconciliations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PaymentAttemptReconciliationQuery>,
) -> Result<Json<Vec<ResearchPaymentReconciliation>>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.research_payment_reconciliations(
        query.limit.unwrap_or(25),
    )?))
}

async fn defer_research_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((id, attempt_id)): Path<(String, String)>,
    Json(request): Json<DeferResearchPaymentRequest>,
) -> Result<Json<ResearchPaymentReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.defer_research_payment_reconciliation(
        &id,
        &attempt_id,
        request.absence_observed,
    )?))
}

async fn settle_research_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((id, attempt_id)): Path<(String, String)>,
    Json(request): Json<SettleResearchPaymentRequest>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.settle_research_payment(
        &id,
        &attempt_id,
        &request.transaction_signature,
    )?))
}

async fn release_research_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((id, attempt_id)): Path<(String, String)>,
    Json(request): Json<ReleaseResearchPaymentRequest>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    require_research_protocol(&headers)?;
    Ok(Json(state.store.release_research_payment(
        &id,
        &attempt_id,
        &request,
    )?))
}

async fn prepare_direct_pay_sh_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(request): Json<PrepareDirectPayShPaymentRequest>,
) -> Result<Json<DirectPayShPaymentReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    let access_token = query_access_token(&headers)?;
    let reconciliation = state.store.prepare_direct_pay_sh_payment(
        &attempt_id,
        &request,
        &token_hash(access_token),
    )?;
    let intent = RollbackAuditIntent::direct(&reconciliation);
    state
        .rollback_audit
        .persist(&intent)
        .await
        .map_err(ApiError::service_unavailable)?;
    Ok(Json(reconciliation))
}

async fn bind_pay_sh_challenges(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<BindPayShChallengesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_internal(&state, &headers)?;
    let direct_token_hash =
        if request.research_job_id.is_some() || request.payment_attempt_id.is_some() {
            require_research_protocol(&headers)?;
            None
        } else {
            Some(token_hash(query_access_token(&headers)?))
        };
    let bound = request.challenges.len();
    state
        .store
        .bind_pay_sh_challenges(&request, direct_token_hash.as_deref())?;
    Ok(Json(serde_json::json!({ "bound": bound })))
}

async fn direct_pay_sh_payment_reconciliations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PaymentAttemptReconciliationQuery>,
) -> Result<Json<Vec<DirectPayShPaymentReconciliation>>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.direct_pay_sh_payment_reconciliations(
        query.limit.unwrap_or(25),
    )?))
}

async fn defer_direct_pay_sh_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(request): Json<DeferResearchPaymentRequest>,
) -> Result<Json<DirectPayShPaymentReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(
        state
            .store
            .defer_direct_pay_sh_payment_reconciliation(&attempt_id, request.absence_observed)?,
    ))
}

async fn settle_direct_pay_sh_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(request): Json<SettleResearchPaymentRequest>,
) -> Result<Json<OpenDocumentsResponse>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.settle_direct_pay_sh_payment(
        &attempt_id,
        &request.transaction_signature,
    )?))
}

async fn release_direct_pay_sh_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(request): Json<ReleaseResearchPaymentRequest>,
) -> Result<Json<DirectPayShPaymentReconciliation>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(
        state
            .store
            .release_direct_pay_sh_payment(&attempt_id, &request)?,
    ))
}

async fn complete_research_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.complete_research_job(&id)?))
}

async fn fail_research_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<FailResearchJobRequest>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.fail_research_job(&id, &request.error)?))
}

async fn hold_research_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<FailResearchJobRequest>,
) -> Result<Json<ResearchJobStatus>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.hold_research_job(&id, &request.error)?))
}

async fn open_call_funding_quote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<OpenCallFundingQuote>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.open_call_funding_quote(&id)?))
}

async fn open_call_funding_snapshot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<OpenCallFundingSnapshot>), ApiError> {
    require_internal(&state, &headers)?;
    Ok((
        private_no_store_headers(),
        Json(state.store.open_call_funding_snapshot(&id)?),
    ))
}

async fn record_open_call_chain_settlement(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RecordChainSettlementRequest>,
) -> Result<Json<ChainSettlementReceipt>, ApiError> {
    require_internal(&state, &headers)?;
    let receipt = state.store.record_open_call_chain_settlement(&request)?;
    AppState::dispatch_pending_emails(Arc::clone(&state));
    Ok(Json(receipt))
}

async fn lease_payout_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<LeasePayoutClaimsRequest>,
) -> Result<Json<Vec<PayoutClaim>>, ApiError> {
    require_internal(&state, &headers)?;
    require_payout_protocol(&headers)?;
    Ok(Json(state.store.lease_payout_claims(
        &request.worker_id,
        &request.escrow_wallet,
        &request.network,
        request.limit,
        request.lease_ms,
    )?))
}

async fn payout_claim_backlog(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<PayoutClaimBacklog>>, ApiError> {
    require_internal(&state, &headers)?;
    require_payout_protocol(&headers)?;
    Ok(Json(state.store.payout_claim_backlogs()?))
}

async fn prepare_payout_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<PreparePayoutClaimRequest>,
) -> Result<Json<PayoutClaim>, ApiError> {
    require_internal(&state, &headers)?;
    require_payout_protocol(&headers)?;
    let claim = state.store.prepare_payout_claim(
        &id,
        &request.worker_id,
        &request.transaction_signature,
        &request.signed_transaction_base64,
        &request.recent_blockhash,
        request.last_valid_block_height,
    )?;
    let intent = RollbackAuditIntent::payout(&claim).map_err(ApiError::service_unavailable)?;
    state
        .rollback_audit
        .persist(&intent)
        .await
        .map_err(ApiError::service_unavailable)?;
    Ok(Json(claim))
}

async fn complete_payout_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<CompletePayoutClaimRequest>,
) -> Result<Json<PayoutClaim>, ApiError> {
    require_internal(&state, &headers)?;
    require_payout_protocol(&headers)?;
    Ok(Json(state.store.complete_payout_claim(
        &id,
        &request.worker_id,
        &request.transaction_signature,
    )?))
}

async fn fail_payout_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<FailPayoutClaimRequest>,
) -> Result<Json<PayoutClaim>, ApiError> {
    require_internal(&state, &headers)?;
    require_payout_protocol(&headers)?;
    Ok(Json(state.store.fail_payout_claim(
        &id,
        &request.worker_id,
        &request.error,
        request.abandon_prepared_transaction,
    )?))
}

fn private_no_store_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    headers
}

fn public_manifest_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=60, stale-while-revalidate=300"),
    );
    headers
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if !(8..=128).contains(&password.chars().count()) {
        return Err(ApiError::validation(
            "password must be between 8 and 128 characters",
        ));
    }
    Ok(())
}

fn reserved_wallet_email(email: &str) -> bool {
    let email = email.trim().to_ascii_lowercase();
    email.ends_with("@wallet.openshelf.local") || email.ends_with("@wallet.obolus.local")
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(ApiError::internal)?
        .to_string())
}

fn session_response(
    state: &AppState,
    mut user: UserAccount,
    status: StatusCode,
) -> Result<(StatusCode, HeaderMap, Json<AuthResponse>), ApiError> {
    // Reflect the effective (allowlist-aware) role in the sign-in response so
    // an allowlisted wallet reaches its admin surfaces immediately, matching
    // what a later GET /api/v1/auth/me would report.
    if user.role != "admin" && state.store.is_admin(&user.id)? {
        user.role = "admin".to_owned();
    }
    let (token, balance, wallet, _) = issue_session(state, &user)?;
    let mut cookie = format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        SESSION_TTL_MS / 1_000
    );
    if state.secure_cookies {
        cookie.push_str("; Secure");
    }
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(ApiError::internal)?,
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((
        status,
        headers,
        Json(AuthResponse {
            user,
            balance,
            wallet,
        }),
    ))
}

fn issue_session(
    state: &AppState,
    user: &UserAccount,
) -> Result<(String, BalanceSummary, Option<String>, u64), ApiError> {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let expires_at = now_ms().saturating_add(SESSION_TTL_MS);
    state
        .store
        .create_session(&user.id, &token_hash(&token), expires_at)?;
    let balance = state.store.balance(&user.id)?;
    let wallet = state.store.identity_wallet(&user.id)?;
    Ok((token, balance, wallet, expires_at))
}

fn expired_session_cookie(state: &AppState) -> Result<HeaderValue, ApiError> {
    let mut cookie = format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    if state.secure_cookies {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).map_err(ApiError::internal)
}

fn expired_prepaid_cookie(state: &AppState) -> Result<HeaderValue, ApiError> {
    let mut cookie =
        format!("{PREPAID_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    if state.secure_cookies {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).map_err(ApiError::internal)
}

fn authenticated(state: &AppState, headers: &HeaderMap) -> Result<UserAccount, ApiError> {
    let token =
        session_token(headers).ok_or_else(|| ApiError::unauthorized("sign in to continue"))?;
    Ok(state.store.authenticate_session(&token_hash(&token))?)
}

fn optional_authenticated(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<UserAccount>, ApiError> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    Ok(Some(state.store.authenticate_session(&token_hash(&token))?))
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        && let Some(token) = value.strip_prefix("Bearer ")
    {
        return Some(token.trim().to_owned());
    }
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == SESSION_COOKIE).then(|| value.to_owned())
            })
        })
}

/// Mirrors session_token's header-or-cookie precedence for the prepaid
/// wallet session. The explicit header stays supported for local cross-origin
/// gateway development and machine clients. In production the same-origin
/// proxy forwards the HttpOnly cookie to both the gateway and this Rust API.
fn prepaid_session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(token) = headers
        .get(PREPAID_SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(token.to_owned());
    }
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == PREPAID_SESSION_COOKIE).then(|| value.to_owned())
            })
        })
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn query_access_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get(QUERY_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("invalid query payment token"))
}

fn require_internal(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let token = headers
        .get(INTERNAL_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if token.is_empty() || token_hash(token) != state.internal_token_hash {
        return Err(ApiError::unauthorized("invalid internal service token"));
    }
    Ok(())
}

fn require_research_protocol(headers: &HeaderMap) -> Result<(), ApiError> {
    let version = headers
        .get(RESEARCH_PROTOCOL_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if version != RESEARCH_PROTOCOL_VERSION {
        return Err(ApiError::upgrade_required(
            "this research worker cannot prove the durable MPP credential fence",
        ));
    }
    Ok(())
}

fn require_payment_protocol(headers: &HeaderMap) -> Result<(), ApiError> {
    let version = headers
        .get(PAYMENT_PROTOCOL_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if version != PAYMENT_PROTOCOL_VERSION {
        return Err(ApiError::upgrade_required(
            "this payment gateway cannot prove exact-evidence reconciliation",
        ));
    }
    Ok(())
}

fn require_payout_protocol(headers: &HeaderMap) -> Result<(), ApiError> {
    let version = headers
        .get(PAYOUT_PROTOCOL_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if version != PAYOUT_PROTOCOL_VERSION {
        return Err(ApiError::upgrade_required(
            "this payout worker cannot prove independent two-pass absence",
        ));
    }
    Ok(())
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    let value = std::env::var(name).ok();
    unsigned_integer_value(name, value.as_deref(), fallback)
        .unwrap_or_else(|error| panic!("invalid runtime configuration: {error}"))
}

fn env_bool(name: &str, fallback: bool) -> bool {
    let value = std::env::var(name).ok();
    boolean_value(name, value.as_deref(), fallback)
        .unwrap_or_else(|error| panic!("invalid runtime configuration: {error}"))
}

fn validate_email_configuration(
    endpoint: Option<&str>,
    api_key: Option<&str>,
    from: Option<&str>,
    production: bool,
    delivery_required: bool,
) -> Result<(), String> {
    let (endpoint, api_key, from) = match (endpoint, api_key, from) {
        (None, None, None) if !delivery_required => return Ok(()),
        (None, None, None) => {
            return Err(
                "email delivery is required when email/password authentication is enabled in production"
                    .to_owned(),
            );
        }
        (Some(endpoint), Some(api_key), Some(from)) => (endpoint, api_key, from),
        _ => {
            return Err(
                "OPENSHELF_EMAIL_ENDPOINT, OPENSHELF_EMAIL_API_KEY, and OPENSHELF_EMAIL_FROM must be configured together"
                    .to_owned(),
            );
        }
    };
    let url = reqwest::Url::parse(endpoint)
        .map_err(|error| format!("OPENSHELF_EMAIL_ENDPOINT is not a valid URL: {error}"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "OPENSHELF_EMAIL_ENDPOINT cannot contain credentials, a query, or a fragment"
                .to_owned(),
        );
    }
    let loopback_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !loopback_http {
        return Err("OPENSHELF_EMAIL_ENDPOINT must use HTTPS unless it is loopback".to_owned());
    }
    if production && url.scheme() != "https" {
        return Err("OPENSHELF_EMAIL_ENDPOINT must use HTTPS in production".to_owned());
    }
    HeaderValue::from_str(api_key)
        .map_err(|_| "OPENSHELF_EMAIL_API_KEY contains invalid header bytes".to_owned())?;
    if from.len() > 320 || from.chars().any(char::is_control) {
        return Err("OPENSHELF_EMAIL_FROM is invalid".to_owned());
    }
    Ok(())
}

fn validate_service_origin(name: &str, value: &str, production: bool) -> Result<String, String> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| format!("{name} must be an absolute HTTP URL: {error}"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!(
            "{name} must be an origin without credentials, path, query, or fragment"
        ));
    }
    let loopback_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !loopback_http {
        return Err(format!("{name} must use HTTPS unless it is loopback"));
    }
    if production && url.scheme() != "https" {
        return Err(format!("{name} must use HTTPS in production"));
    }
    Ok(url.origin().ascii_serialization())
}

fn now_ms() -> u64 {
    monotonic_unix_time_ms()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDocumentsQuery {
    query_id: String,
    docs: String,
    payer: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PayShDocumentQuery {
    owner_wallet: String,
    quote_id: String,
    research_job_id: Option<String>,
    payment_attempt_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PayerQuery {
    payer: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment: Option<String>,
    #[serde(rename = "authMode", skip_serializing_if = "Option::is_none")]
    auth_mode: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn service_unavailable(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "rollback audit unavailable before external side effect");
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "external_audit_unavailable",
            message: "the external operation is safely paused until its durable audit record is available"
                .to_owned(),
        }
    }

    fn upgrade_required(message: &str) -> Self {
        Self {
            status: StatusCode::UPGRADE_REQUIRED,
            code: "worker_upgrade_required",
            message: message.to_owned(),
        }
    }

    fn unauthorized(message: &str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
            message: message.to_owned(),
        }
    }

    fn validation(message: &str) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "invalid_request",
            message: message.to_owned(),
        }
    }

    fn forbidden(message: &str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "forbidden",
            message: message.to_owned(),
        }
    }

    fn conflict(message: &str) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "conflict",
            message: message.to_owned(),
        }
    }

    fn gone(message: &str) -> Self {
        Self {
            status: StatusCode::GONE,
            code: "gone",
            message: message.to_owned(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "internal API error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: "an internal error occurred".to_owned(),
        }
    }
}

impl From<ResolveError> for ApiError {
    fn from(error: ResolveError) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "invalid_question",
            message: error.to_string(),
        }
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        let (status, code) = match &error {
            StoreError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            StoreError::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_request"),
            StoreError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            StoreError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            StoreError::RateLimited(_) => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            StoreError::DocumentNotQuoted => (StatusCode::FORBIDDEN, "document_not_quoted"),
            StoreError::Database(_) | StoreError::Io(_) | StoreError::LockPoisoned => {
                tracing::error!(error = %error, "backend store error");
                return Self {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    code: "internal_error",
                    message: "an internal error occurred".to_owned(),
                };
            }
        };
        Self {
            status,
            code,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::Arc,
        time::{Duration, Instant},
    };

    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{
        db::Connection, demo_app, domain::RecordPrepaidDepositRequest, params,
        rollback_audit::RollbackAudit, store::Store,
    };

    use super::{
        AppState, BASE64_STANDARD, QUERY_TOKEN_HEADER, router, validate_email_configuration,
        validate_service_origin,
    };

    async fn register(app: &axum::Router, email: &str) -> String {
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": email,
                            "password": "correct-horse-42",
                            "ageConfirmed14": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        response
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned()
    }

    async fn user_id_from_me(app: &axum::Router, cookie: &str) -> String {
        let response = app
            .clone()
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        body["user"]["id"].as_str().unwrap().to_owned()
    }

    #[tokio::test]
    async fn admin_table_endpoint_serves_regular_signed_in_accounts() {
        let app = demo_app();
        let cookie = register(&app, "not-admin@example.com").await;
        let response = app
            .oneshot(
                Request::get("/api/v1/admin/tables/users")
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["table"], "users");
        assert!(!body["rows"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn admin_table_endpoint_serves_admins_without_secrets() {
        let store = Store::in_memory().unwrap();
        let app = router(Arc::new(
            AppState::new(store.clone()).with_email_password_auth_enabled(true),
        ));
        let cookie = register(&app, "table-admin@example.com").await;
        let id = user_id_from_me(&app, &cookie).await;
        // Promote through the shared store handle the app is running on.
        store.set_user_role(&id, "admin").unwrap();

        let response = app
            .oneshot(
                Request::get("/api/v1/admin/tables/users?limit=5")
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["table"], "users");
        assert!(!body["rows"].as_array().unwrap().is_empty());
        assert!(
            body["columns"]
                .as_array()
                .unwrap()
                .iter()
                .all(|column| column != "password_hash")
        );
        // The redacted column must not appear anywhere in the payload.
        let raw = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(!raw.contains("password_hash"));
    }

    #[tokio::test]
    async fn me_reports_admin_for_an_allowlisted_wallet() {
        let store = Store::in_memory().unwrap();
        let app = router(Arc::new(
            AppState::new(store.clone()).with_email_password_auth_enabled(true),
        ));
        let cookie = register(&app, "wallet-admin@example.com").await;
        let id = user_id_from_me(&app, &cookie).await;
        // Bind a baked-in admin wallet; the persisted role stays 'user'.
        store
            .bind_wallet_identity(&id, "G74HqEPzpUd9nLhXpkWViQsWxK3PVnqzHHe6Q7mY8AAY")
            .unwrap();

        let response = app
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["user"]["role"], "admin");
    }

    #[tokio::test]
    async fn wallet_only_router_omits_email_credential_routes() {
        let state =
            AppState::new(Store::in_memory().unwrap()).with_email_password_auth_enabled(false);
        let app = router(Arc::new(state));
        for path in [
            "/api/v1/auth/register",
            "/api/v1/auth/login",
            "/api/v1/auth/password/forgot",
            "/api/v1/auth/password/reset",
        ] {
            let response = app
                .clone()
                .oneshot(Request::post(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }

        let response = app
            .oneshot(
                Request::post("/api/v1/auth/wallet/challenge")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "wallet": "FhRsUMzQieS8TXacCaGhLZrFNEQrUwqGkYBVzLeiUP8H",
                            "purpose": "wallet_login_v1"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn registration_creates_an_authenticated_sandbox_account() {
        let app = demo_app();
        let cookie = register(&app, "buyer@example.com").await;
        let response = app
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["user"]["email"], "buyer@example.com");
        // Pure web3 (Product Decision (a)): no signup credit — new accounts start
        // at a zero internal balance.
        assert_eq!(body["balance"]["availableKrw"], 0);
        assert_eq!(body["balance"]["availableAtomic"], "0");
    }

    #[tokio::test]
    async fn registration_requires_an_explicit_age_confirmation() {
        let response = demo_app()
            .oneshot(
                Request::post("/api/v1/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": "minor@example.com",
                            "password": "correct-horse-42",
                            "ageConfirmed14": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn wallet_sign_in_proves_ownership_and_reuses_one_account() {
        let app = demo_app();
        let signing_key = SigningKey::from_bytes(&[91_u8; 32]);
        let wallet = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();

        let challenge_response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/challenge")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "wallet": wallet, "purpose": "wallet_login_v1" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::CREATED);
        assert_eq!(
            challenge_response
                .headers()
                .get(header::CACHE_CONTROL)
                .unwrap(),
            "private, no-store"
        );
        let challenge: Value = serde_json::from_slice(
            &challenge_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let challenge_message = challenge["message"].as_str().unwrap();
        assert!(challenge_message.contains("Origin: http://localhost:4319"));
        assert!(
            challenge_message
                .contains(&format!("Challenge: {}", challenge["id"].as_str().unwrap()))
        );
        let lookalike_signature = bs58::encode(
            signing_key
                .sign(
                    challenge_message
                        .replace("http://localhost:4319", "https://obolus-login.example")
                        .as_bytes(),
                )
                .to_bytes(),
        )
        .into_string();
        let lookalike = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/verify")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "wallet": wallet,
                            "challengeId": challenge["id"],
                            "signature": lookalike_signature,
                            "ageConfirmed14": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lookalike.status(), StatusCode::UNAUTHORIZED);
        let signature =
            bs58::encode(signing_key.sign(challenge_message.as_bytes()).to_bytes()).into_string();
        let verify_body = json!({
            "wallet": wallet,
            "challengeId": challenge["id"],
            "signature": signature,
            "ageConfirmed14": true
        });
        let verified = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/verify")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(verify_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(verified.status(), StatusCode::CREATED);
        assert_eq!(
            verified.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let cookie = verified
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        let created: Value =
            serde_json::from_slice(&verified.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let user_id = created["user"]["id"].as_str().unwrap().to_owned();
        assert_eq!(created["wallet"], wallet);
        assert!(
            created["user"]["email"]
                .as_str()
                .unwrap()
                .ends_with("@wallet.obolus.local")
        );

        let me = app
            .clone()
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(me.status(), StatusCode::OK);
        let me_body: Value =
            serde_json::from_slice(&me.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(me_body["wallet"], wallet);

        let profile = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "handle": "signed_wallet_owner",
                            "ageBand": "35-44",
                            "region": "seoul",
                            "household": "alone",
                            "field": "travel",
                            "years": "7-plus",
                            "speaksTo": ["travel"],
                            "wallet": wallet
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(profile.status(), StatusCode::OK);
        let profile_body: Value =
            serde_json::from_slice(&profile.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(profile_body["wallet"], wallet);
        assert_eq!(profile_body["walletVerified"], true);

        let unrelated_key = SigningKey::from_bytes(&[92_u8; 32]);
        let unrelated_wallet = bs58::encode(unrelated_key.verifying_key().as_bytes()).into_string();
        let unrelated_profile = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "handle": "signed_wallet_owner",
                            "ageBand": "35-44",
                            "region": "seoul",
                            "household": "alone",
                            "field": "travel",
                            "years": "7-plus",
                            "speaksTo": ["travel"],
                            "wallet": unrelated_wallet
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unrelated_profile.status(), StatusCode::OK);
        let unrelated_body: Value = serde_json::from_slice(
            &unrelated_profile
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        assert_eq!(unrelated_body["wallet"], unrelated_wallet);
        assert_eq!(unrelated_body["walletVerified"], false);

        let replay = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/verify")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(verify_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::CONFLICT);

        let second_challenge = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/challenge")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "wallet": wallet, "purpose": "wallet_login_v1" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let second: Value = serde_json::from_slice(
            &second_challenge
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let second_signature = bs58::encode(
            signing_key
                .sign(second["message"].as_str().unwrap().as_bytes())
                .to_bytes(),
        )
        .into_string();
        let signed_in = app
            .oneshot(
                Request::post("/api/v1/auth/wallet/verify")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "wallet": wallet,
                            "challengeId": second["id"],
                            "signature": second_signature,
                            "ageConfirmed14": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(signed_in.status(), StatusCode::OK);
        let signed_in_body: Value =
            serde_json::from_slice(&signed_in.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(signed_in_body["user"]["id"], user_id);
    }

    /// GitHub issue #46 acceptance criterion: a login challenge cannot mint a
    /// prepaid session, enforced end to end over HTTP (the store-level
    /// enforcement is covered separately in store::tests).
    #[tokio::test]
    async fn wallet_login_challenge_cannot_be_redeemed_at_the_prepaid_session_endpoint() {
        let app = demo_app();
        let cookie = register(&app, "prepaid-purpose-guard@example.com").await;
        let signing_key = SigningKey::from_bytes(&[108_u8; 32]);
        let wallet = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();

        let challenge_response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/challenge")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "wallet": wallet, "purpose": "wallet_login_v1" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::CREATED);
        let challenge: Value = serde_json::from_slice(
            &challenge_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        assert_eq!(challenge["purpose"], "wallet_login_v1");
        let message = challenge["message"].as_str().unwrap();
        let signature = bs58::encode(signing_key.sign(message.as_bytes()).to_bytes()).into_string();

        let prepaid_attempt = app
            .oneshot(
                Request::post("/api/v1/prepaid/session")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "wallet": wallet,
                            "challengeId": challenge["id"],
                            "signature": signature
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(prepaid_attempt.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn public_key_derived_legacy_passwords_cannot_sign_in() {
        let response = demo_app()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": "publickey@wallet.openshelf.local",
                            "password": "publicly-derived-value"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn synthetic_wallet_email_cannot_be_preclaimed_or_password_reset() {
        let store = Store::in_memory().unwrap();
        let synthetic_email =
            "7d5c0b2f5da2b1aa3ae80d789d27de65f5f76b6181269d60c45d7b55c155beef@wallet.obolus.local";
        let app = router(Arc::new(
            AppState::new(store.clone()).with_email_password_auth_enabled(true),
        ));
        let preclaim = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": synthetic_email,
                            "password": "attacker-controlled-password",
                            "ageConfirmed14": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(preclaim.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // Model an already-existing wallet-only account. Even if a deployment
        // has a catch-all mail route, password reset must not turn its synthetic
        // identifier into an email-authentication backdoor.
        store
            .register_user(synthetic_email, "wallet-generated-random-password-hash")
            .unwrap();
        let forgot = app
            .oneshot(
                Request::post("/api/v1/auth/password/forgot")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "email": synthetic_email }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forgot.status(), StatusCode::NO_CONTENT);
        assert!(store.pending_emails(10).unwrap().is_empty());
    }

    #[tokio::test]
    async fn unknown_and_wrong_password_logins_share_the_argon2_failure_surface() {
        let app = demo_app();
        register(&app, "known-login@example.com").await;
        let login = |email: &'static str| {
            app.clone().oneshot(
                Request::post("/api/v1/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": email,
                            "password": "same-wrong-password"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
        };
        let wrong_known = login("known-login@example.com").await.unwrap();
        let unknown = login("unknown-login@example.com").await.unwrap();
        assert_eq!(wrong_known.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
        let wrong_body = wrong_known.into_body().collect().await.unwrap().to_bytes();
        let unknown_body = unknown.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(wrong_body, unknown_body);
    }

    #[tokio::test]
    async fn readiness_checks_the_store() {
        let path = std::env::temp_dir().join(format!(
            "openshelf-readiness-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = Store::open(&path).unwrap();
        let app = router(Arc::new(AppState::new(store.clone())));
        let response = app
            .clone()
            .oneshot(Request::get("/readyz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let email = "future-readiness-lease@example.com";
        store.register_user(email, "password-hash").unwrap();
        store
            .queue_password_reset(
                email,
                &"a".repeat(64),
                "future-readiness-token-with-at-least-32-bytes",
                "https://openshelf.example",
            )
            .unwrap();
        let queued = store.pending_emails(1).unwrap();
        assert_eq!(queued.len(), 1);
        store
            .lease_pending_emails("readiness-email-worker", 1, 60_000)
            .unwrap();
        let corruptor = Connection::open(&path).unwrap();
        corruptor
            .execute(
                "UPDATE email_outbox SET lease_expires_at = ?1 WHERE id = ?2",
                params![i64::MAX, queued[0].id.clone()],
            )
            .unwrap();

        let hidden_recovery = app
            .oneshot(Request::get("/readyz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(hidden_recovery.status(), StatusCode::SERVICE_UNAVAILABLE);
        drop(corruptor);
        drop(store);
        for suffix in ["", "-wal", "-shm"] {
            let target = format!("{}{suffix}", path.display());
            if std::path::Path::new(&target).exists() {
                std::fs::remove_file(target).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn two_api_instances_emit_one_email_with_the_durable_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/send", listener.local_addr().unwrap());
        let provider = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut requests = Vec::new();
            let mut last_request_at = None;
            while Instant::now() < deadline
                && last_request_at.is_none_or(|last| {
                    Instant::now().duration_since(last) < Duration::from_millis(300)
                })
            {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut bytes = Vec::new();
                        let mut chunk = [0_u8; 2_048];
                        let read_deadline = Instant::now() + Duration::from_secs(2);
                        loop {
                            match stream.read(&mut chunk) {
                                Ok(0) => break,
                                Ok(read) => {
                                    bytes.extend_from_slice(&chunk[..read]);
                                    if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                                        break;
                                    }
                                }
                                Err(error)
                                    if matches!(
                                        error.kind(),
                                        std::io::ErrorKind::WouldBlock
                                            | std::io::ErrorKind::TimedOut
                                    ) && Instant::now() < read_deadline => {}
                                Err(error) => panic!("email provider request read failed: {error}"),
                            }
                        }
                        requests.push(String::from_utf8_lossy(&bytes).into_owned());
                        stream
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                            .unwrap();
                        last_request_at = Some(Instant::now());
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("email provider socket failed: {error}"),
                }
            }
            requests
        });

        let store = Store::in_memory().unwrap();
        let email = "socket-email-race@example.com";
        store.register_user(email, "irrelevant-test-hash").unwrap();
        store
            .queue_password_reset(
                email,
                &"4".repeat(64),
                "socket-reset-token-with-at-least-32-bytes",
                "https://openshelf.example",
            )
            .unwrap();
        let email_id = store.pending_emails(10).unwrap()[0].id.clone();

        let mut first = AppState::new(store.clone());
        first.email_endpoint = Some(endpoint.clone());
        first.email_api_key = Some("provider-test-secret".to_owned());
        first.email_from = Some("alerts@example.com".to_owned());
        first.email_worker_id = "socket-email-worker-alpha".to_owned();
        let mut second = AppState::new(store.clone());
        second.email_endpoint = Some(endpoint);
        second.email_api_key = Some("provider-test-secret".to_owned());
        second.email_from = Some("alerts@example.com".to_owned());
        second.email_worker_id = "socket-email-worker-bravo".to_owned();

        tokio::join!(
            first.deliver_pending_emails(),
            second.deliver_pending_emails()
        );
        let requests = provider.join().expect("email provider should not panic");
        assert_eq!(
            requests.len(),
            1,
            "the external email provider must see one request from two API instances"
        );
        let request = requests[0].to_ascii_lowercase();
        assert!(request.lines().any(|line| {
            line.split_once(':').is_some_and(|(name, value)| {
                name.eq_ignore_ascii_case("idempotency-key")
                    && value.trim().eq_ignore_ascii_case(&email_id)
            })
        }));
        // A still-sending row would allow exactly one of these worker ids to
        // mutate it. Both conflicts prove the successful provider response was
        // durably completed before the delivery tasks returned.
        assert!(
            store
                .mark_email_failed(&email_id, "socket-email-worker-alpha", "late result")
                .is_err()
        );
        assert!(
            store
                .mark_email_failed(&email_id, "socket-email-worker-bravo", "late result")
                .is_err()
        );
        assert!(store.pending_emails(10).unwrap().is_empty());
    }

    #[test]
    fn email_delivery_configuration_fails_closed_when_managed_email_auth_is_enabled() {
        assert!(validate_email_configuration(None, None, None, false, false).is_ok());
        assert!(validate_email_configuration(None, None, None, true, false).is_ok());
        assert!(
            validate_email_configuration(None, None, None, true, true)
                .unwrap_err()
                .contains("email/password authentication")
        );
        assert!(
            validate_email_configuration(
                Some("https://api.email.example/send"),
                None,
                Some("alerts@example.com"),
                true,
                true,
            )
            .unwrap_err()
            .contains("configured together")
        );
        assert!(
            validate_email_configuration(
                Some("http://api.email.example/send"),
                Some("secret"),
                Some("alerts@example.com"),
                false,
                false,
            )
            .unwrap_err()
            .contains("HTTPS")
        );
        assert!(
            validate_email_configuration(
                Some("http://127.0.0.1:9999/send"),
                Some("secret"),
                Some("alerts@example.com"),
                false,
                false,
            )
            .is_ok()
        );
        assert!(
            validate_email_configuration(
                Some("http://127.0.0.1:9999/send"),
                Some("secret"),
                Some("alerts@example.com"),
                true,
                true,
            )
            .unwrap_err()
            .contains("production")
        );
        assert!(
            validate_email_configuration(
                Some("https://api.email.example/send?api_key=leaked"),
                Some("secret"),
                Some("alerts@example.com"),
                true,
                true,
            )
            .unwrap_err()
            .contains("query")
        );
    }

    #[test]
    fn credential_bearing_origins_reject_lookalike_transport_configuration() {
        assert_eq!(
            validate_service_origin("API", "https://api.example", true).unwrap(),
            "https://api.example"
        );
        assert_eq!(
            validate_service_origin("API", "http://127.0.0.1:8787", false).unwrap(),
            "http://127.0.0.1:8787"
        );
        assert!(
            validate_service_origin("API", "http://api.example", false)
                .unwrap_err()
                .contains("HTTPS")
        );
        assert!(
            validate_service_origin("API", "https://api.example/internal", true)
                .unwrap_err()
                .contains("without credentials")
        );
        assert!(
            validate_service_origin("API", "https://api.example?token=misplaced", true)
                .unwrap_err()
                .contains("without credentials")
        );
        assert!(
            validate_service_origin("API", "https://user:secret@api.example", true)
                .unwrap_err()
                .contains("without credentials")
        );
    }

    #[tokio::test]
    async fn resolution_issues_a_token_that_guards_payment_progress() {
        let app = demo_app();
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/questions/resolve")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Where do Seongsu residents eat lunch when the queue is long?",
                            "requestedDocuments": 1
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let query_id = body["queryId"].as_str().unwrap();
        let token = body["paymentAccessToken"].as_str().unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(body["agentRun"]["steps"].as_array().unwrap().len(), 3);
        assert_eq!(
            body["agentRun"]["steps"][0]["tool"],
            "search_human_evidence"
        );
        assert!(
            !body["agentRun"]["steps"]
                .to_string()
                .to_lowercase()
                .contains("chain-of-thought")
        );

        let progress_path = format!(
            "/api/v1/questions/{query_id}/payment-progress?payer=11111111111111111111111111111111"
        );
        let unauthorized = app
            .clone()
            .oneshot(
                Request::get(&progress_path)
                    .header(QUERY_TOKEN_HEADER, "wrong-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let progress = app
            .oneshot(
                Request::get(&progress_path)
                    .header(QUERY_TOKEN_HEADER, token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(progress.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn external_payment_permission_waits_for_audit_and_exact_retry_recovers_after_restart() {
        let store = Store::in_memory().unwrap();
        let audit = RollbackAudit::memory(true);
        let mut first_state = AppState::new(store.clone()).with_rollback_audit(audit.clone());
        first_state.payment_policy.fallback_recipient =
            Some("11111111111111111111111111111111".to_owned());
        let first_app = router(Arc::new(first_state));
        let resolution = first_app
            .clone()
            .oneshot(
                Request::post("/api/v1/questions/resolve")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Where do Seongsu residents eat lunch when the queue is long?",
                            "requestedDocuments": 1
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resolution.status(), StatusCode::OK);
        let resolution: Value =
            serde_json::from_slice(&resolution.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let query_id = resolution["queryId"].as_str().unwrap();
        let handle = resolution["matches"][0]["handle"].as_str().unwrap();
        let quote = first_app
            .clone()
            .oneshot(
                Request::get(format!("/internal/v1/payment-quotes/{query_id}/{handle}"))
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(quote.status(), StatusCode::OK);
        let quote: Value =
            serde_json::from_slice(&quote.into_body().collect().await.unwrap().to_bytes()).unwrap();

        let incomplete_attempt_id = "e".repeat(64);
        let incomplete = first_app
            .clone()
            .oneshot(
                Request::post("/internal/v1/payment-attempts")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYMENT_PROTOCOL_HEADER,
                        super::PAYMENT_PROTOCOL_VERSION,
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "settlementKind": "document",
                            "quoteId": quote["id"],
                            "attemptId": incomplete_attempt_id
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(incomplete.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert!(store.payment_attempt(&incomplete_attempt_id).is_err());

        let mut signed_transaction_bytes = vec![42_u8; 180];
        signed_transaction_bytes[0] = 2;
        signed_transaction_bytes[1..65].fill(0);
        signed_transaction_bytes[65..129].fill(79);
        let signed_transaction = BASE64_STANDARD.encode(signed_transaction_bytes);
        let attempt_id = super::token_hash(&signed_transaction);
        let claim = json!({
            "settlementKind": "document",
            "quoteId": quote["id"],
            "attemptId": attempt_id,
            "payer": "11111111111111111111111111111111",
            "signedTransactionBase64": signed_transaction,
            "recentBlockhash": "11111111111111111111111111111111"
        });
        let failed_before_external_permission = first_app
            .oneshot(
                Request::post("/internal/v1/payment-attempts")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYMENT_PROTOCOL_HEADER,
                        super::PAYMENT_PROTOCOL_VERSION,
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(claim.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            failed_before_external_permission.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert!(store.payment_attempt(&attempt_id).is_ok());
        assert_eq!(audit.memory_object_count(), 0);

        // Model process death between the DB commit and the audit write: a new
        // application state receives the same signed transaction. It must
        // recover the prior fence and emit exactly one immutable audit object.
        audit.set_memory_failure(false);
        let mut restarted_state = AppState::new(store.clone()).with_rollback_audit(audit.clone());
        restarted_state.payment_policy.fallback_recipient =
            Some("11111111111111111111111111111111".to_owned());
        let restarted_app = router(Arc::new(restarted_state));
        for _ in 0..2 {
            let recovered = restarted_app
                .clone()
                .oneshot(
                    Request::post("/internal/v1/payment-attempts")
                        .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                        .header(
                            super::PAYMENT_PROTOCOL_HEADER,
                            super::PAYMENT_PROTOCOL_VERSION,
                        )
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(claim.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(recovered.status(), StatusCode::OK);
        }
        assert_eq!(audit.memory_object_count(), 1);

        let mut changed_transaction_bytes = vec![42_u8; 180];
        changed_transaction_bytes[0] = 2;
        changed_transaction_bytes[1..65].fill(0);
        changed_transaction_bytes[65..129].fill(80);
        let changed_transaction = BASE64_STANDARD.encode(changed_transaction_bytes);
        let changed_claim = json!({
            "settlementKind": "document",
            "quoteId": quote["id"],
            "attemptId": super::token_hash(&changed_transaction),
            "payer": "11111111111111111111111111111111",
            "signedTransactionBase64": changed_transaction,
            "recentBlockhash": "11111111111111111111111111111111"
        });
        let competing = restarted_app
            .oneshot(
                Request::post("/internal/v1/payment-attempts")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYMENT_PROTOCOL_HEADER,
                        super::PAYMENT_PROTOCOL_VERSION,
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(changed_claim.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(competing.status(), StatusCode::CONFLICT);
        assert_eq!(audit.memory_object_count(), 1);
    }

    #[tokio::test]
    async fn model_provider_is_never_called_without_audit_and_safe_preflight_failure_releases_budget()
     {
        let store = Store::in_memory().unwrap();
        let audit = RollbackAudit::memory(true);
        let state = AppState::new(store.clone()).with_rollback_audit(audit.clone());
        let input_hash = "d".repeat(64);
        let window_started_at = match store
            .claim_ai_generation("baseline", "rollback-model-scope", &input_hash, &[])
            .unwrap()
        {
            crate::store::AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            _ => panic!("first exact model input should acquire its provider budget"),
        };
        let error = super::authorize_model_call(
            &state,
            "baseline",
            "rollback-model-scope",
            &input_hash,
            window_started_at,
            "general-liquidity-v1:vertex:test-model",
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(audit.memory_object_count(), 0);

        let retry_window = match store
            .claim_ai_generation("baseline", "rollback-model-scope", &input_hash, &[])
            .unwrap()
        {
            crate::store::AiGenerationClaim::Acquired { window_started_at } => window_started_at,
            _ => panic!("an audit outage before transport must not consume the model budget"),
        };
        assert_eq!(retry_window, window_started_at);
        audit.set_memory_failure(false);
        assert!(
            super::authorize_model_call(
                &state,
                "baseline",
                "rollback-model-scope",
                &input_hash,
                retry_window,
                "general-liquidity-v1:vertex:test-model",
            )
            .await
            .is_ok()
        );
        assert_eq!(audit.memory_object_count(), 1);
        assert!(matches!(
            store
                .claim_ai_generation("baseline", "rollback-model-scope", &input_hash, &[])
                .unwrap(),
            crate::store::AiGenerationClaim::Suppressed
        ));
    }

    #[tokio::test]
    async fn synthesis_requires_the_query_payment_token() {
        let response = demo_app()
            .oneshot(
                Request::post("/api/v1/answers/synthesize")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "queryId": "qry_not_a_capability",
                            "handles": ["SEONGSU_101"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
    }

    #[tokio::test]
    async fn wallet_verification_api_accepts_a_valid_signed_challenge() {
        let app = demo_app();
        let cookie = register(&app, "wallet-api@example.com").await;
        let profile = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "handle": "wallet_api",
                            "ageBand": "35-44",
                            "region": "seoul",
                            "household": "alone",
                            "field": "engineering",
                            "years": "7-plus",
                            "speaksTo": ["engineering"],
                            "autoMatch": true,
                            "agents": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(profile.status(), StatusCode::OK);

        let signing_key = SigningKey::from_bytes(&[11; 32]);
        let wallet = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let challenge_response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile/wallet/challenge")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "wallet": wallet }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::CREATED);
        let challenge: Value = serde_json::from_slice(
            &challenge_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let signature = bs58::encode(
            signing_key
                .sign(challenge["message"].as_str().unwrap().as_bytes())
                .to_bytes(),
        )
        .into_string();
        let verify_response = app
            .oneshot(
                Request::post("/api/v1/profile/wallet/verify")
                    .header(header::COOKIE, cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "challengeId": challenge["id"],
                            "signature": signature
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(verify_response.status(), StatusCode::OK);
        let verified: Value = serde_json::from_slice(
            &verify_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        assert_eq!(verified["walletVerified"], true);
        assert_eq!(verified["wallet"], wallet);
    }

    #[tokio::test]
    async fn local_pay_siwx_login_returns_a_bearer_session_without_a_browser_cookie() {
        let app = demo_app();
        let link_response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/wallet/siwx")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "ageConfirmed14": true }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(link_response.status(), StatusCode::CREATED);
        let link: Value = serde_json::from_slice(
            &link_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let resource = reqwest::Url::parse(link["resourceUrl"].as_str().unwrap()).unwrap();
        let resource_path = resource.path().to_owned();
        let challenge_response = app
            .clone()
            .oneshot(Request::get(&resource_path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::PAYMENT_REQUIRED);
        let envelope: Value = serde_json::from_slice(
            &challenge_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let info = &envelope["extensions"]["sign-in-with-x"]["info"];
        let chain = &envelope["extensions"]["sign-in-with-x"]["supportedChains"][0];
        let signing_key = SigningKey::from_bytes(&[29; 32]);
        let address = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let chain_id = chain["chainId"].as_str().unwrap();
        let message = format!(
            "{} wants you to sign in with your Solana account:\n{}\n\n{}\n\nURI: {}\nVersion: {}\nChain ID: {}\nNonce: {}\nIssued At: {}\nExpiration Time: {}\nRequest ID: {}\nResources:\n- {}",
            info["domain"].as_str().unwrap(),
            address,
            info["statement"].as_str().unwrap(),
            info["uri"].as_str().unwrap(),
            info["version"].as_str().unwrap(),
            chain_id.strip_prefix("solana:").unwrap(),
            info["nonce"].as_str().unwrap(),
            info["issuedAt"].as_str().unwrap(),
            info["expirationTime"].as_str().unwrap(),
            info["requestId"].as_str().unwrap(),
            info["resources"][0].as_str().unwrap(),
        );
        let payload = json!({
            "domain": info["domain"],
            "address": address,
            "uri": info["uri"],
            "statement": info["statement"],
            "version": info["version"],
            "chainId": chain_id,
            "nonce": info["nonce"],
            "issuedAt": info["issuedAt"],
            "expirationTime": info["expirationTime"],
            "requestId": info["requestId"],
            "resources": info["resources"],
            "type": chain["type"],
            "signatureScheme": chain["signatureScheme"],
            "signature": bs58::encode(signing_key.sign(message.as_bytes()).to_bytes()).into_string()
        });
        let signed_header = BASE64_STANDARD.encode(serde_json::to_vec(&payload).unwrap());
        let login_response = app
            .clone()
            .oneshot(
                Request::get(&resource_path)
                    .header("SIGN-IN-WITH-X", signed_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_response.status(), StatusCode::CREATED);
        assert!(!login_response.headers().contains_key(header::SET_COOKIE));
        let login: Value = serde_json::from_slice(
            &login_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        assert_eq!(login["wallet"], payload["address"]);
        assert_eq!(login["sessionToken"].as_str().unwrap().len(), 64);
        let me = app
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", login["sessionToken"].as_str().unwrap()),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(me.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn pay_siwx_api_advertises_and_consumes_one_signed_wallet_link() {
        let app = demo_app();
        let cookie = register(&app, "pay-siwx-api@example.com").await;
        let profile = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "handle": "pay_siwx_api",
                            "ageBand": "35-44",
                            "region": "seoul",
                            "household": "alone",
                            "field": "engineering",
                            "years": "7-plus",
                            "speaksTo": ["engineering"],
                            "autoMatch": true,
                            "agents": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(profile.status(), StatusCode::OK);

        let link_response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile/wallet/siwx")
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(link_response.status(), StatusCode::CREATED);
        let link: Value = serde_json::from_slice(
            &link_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let resource = reqwest::Url::parse(link["resourceUrl"].as_str().unwrap()).unwrap();
        let resource_path = resource.path().to_owned();

        let challenge_response = app
            .clone()
            .oneshot(Request::get(&resource_path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(challenge_response.status(), StatusCode::PAYMENT_REQUIRED);
        assert_eq!(
            challenge_response
                .headers()
                .get(header::CACHE_CONTROL)
                .unwrap(),
            "no-store"
        );
        assert!(
            challenge_response
                .headers()
                .contains_key("payment-required")
        );
        let envelope: Value = serde_json::from_slice(
            &challenge_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let extension = &envelope["extensions"]["sign-in-with-x"];
        let info = &extension["info"];
        let chain = &extension["supportedChains"][0];
        let signing_key = SigningKey::from_bytes(&[17; 32]);
        let address = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let chain_id = chain["chainId"].as_str().unwrap();
        let chain_reference = chain_id.strip_prefix("solana:").unwrap();
        let message = format!(
            "{} wants you to sign in with your Solana account:\n{}\n\n{}\n\nURI: {}\nVersion: {}\nChain ID: {}\nNonce: {}\nIssued At: {}\nExpiration Time: {}\nRequest ID: {}\nResources:\n- {}",
            info["domain"].as_str().unwrap(),
            address,
            info["statement"].as_str().unwrap(),
            info["uri"].as_str().unwrap(),
            info["version"].as_str().unwrap(),
            chain_reference,
            info["nonce"].as_str().unwrap(),
            info["issuedAt"].as_str().unwrap(),
            info["expirationTime"].as_str().unwrap(),
            info["requestId"].as_str().unwrap(),
            info["resources"][0].as_str().unwrap(),
        );
        let payload = json!({
            "domain": info["domain"],
            "address": address,
            "uri": info["uri"],
            "statement": info["statement"],
            "version": info["version"],
            "chainId": chain_id,
            "nonce": info["nonce"],
            "issuedAt": info["issuedAt"],
            "expirationTime": info["expirationTime"],
            "requestId": info["requestId"],
            "resources": info["resources"],
            "type": chain["type"],
            "signatureScheme": chain["signatureScheme"],
            "signature": bs58::encode(signing_key.sign(message.as_bytes()).to_bytes()).into_string()
        });
        let signed_header = BASE64_STANDARD.encode(serde_json::to_vec(&payload).unwrap());
        let verified_response = app
            .clone()
            .oneshot(
                Request::get(&resource_path)
                    .header("SIGN-IN-WITH-X", &signed_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(verified_response.status(), StatusCode::OK);
        assert_eq!(
            verified_response
                .headers()
                .get(header::CACHE_CONTROL)
                .unwrap(),
            "no-store"
        );
        let verified: Value = serde_json::from_slice(
            &verified_response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        assert_eq!(verified["walletVerified"], true);
        assert_eq!(verified["wallet"], payload["address"]);

        let replay = app
            .oneshot(
                Request::get(resource_path)
                    .header("SIGN-IN-WITH-X", signed_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn private_routes_reject_spoofed_user_ids() {
        let app = demo_app();
        let response = app
            .oneshot(
                Request::get("/api/v1/memory?userId=demo-user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn payment_ledger_routes_require_the_internal_service_token() {
        for path in [
            "/internal/v1/payment-quotes/query/document",
            "/internal/v1/payment-quotes/query/snapshot",
            "/internal/v1/pay-sh-quotes/quote",
            "/internal/v1/payment-attempts/reconciliation",
            "/internal/v1/research-payment-attempts/reconciliation",
            "/internal/v1/direct-pay-sh-attempts/reconciliation",
            "/internal/v1/payment-bundles/bundle",
            "/internal/v1/payment-bundles/bundle/snapshot",
        ] {
            let response = demo_app()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
        let unfenced_research_payment = demo_app()
            .oneshot(
                Request::post("/internal/v1/research-jobs/job/payment-attempts")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"quoteId":"quote","attemptId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unfenced_research_payment.status(), StatusCode::UNAUTHORIZED);
        let retired = demo_app()
            .oneshot(
                Request::get(
                    "/api/v1/pay-sh/documents/700/query/document?owner_wallet=owner&quote_id=quote",
                )
                .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(retired.status(), StatusCode::GONE);
        let current_without_gateway_proof = demo_app()
            .oneshot(
                Request::get(
                    "/api/v2/pay-sh/documents/700/query/document?owner_wallet=owner&quote_id=quote",
                )
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            current_without_gateway_proof.status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn rolling_old_research_workers_are_stopped_before_receiving_a_paid_resource() {
        for path in [
            "/internal/v1/research-jobs/runnable",
            "/internal/v1/research-jobs/old-worker-job/plan",
        ] {
            let response = demo_app()
                .oneshot(
                    Request::get(path)
                        .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UPGRADE_REQUIRED);
        }

        let current_worker = demo_app()
            .oneshot(
                Request::get("/internal/v1/research-jobs/runnable")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::RESEARCH_PROTOCOL_HEADER,
                        super::RESEARCH_PROTOCOL_VERSION,
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(current_worker.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rolling_old_payment_gateways_cannot_mutate_exact_chain_fences() {
        let old_scanner = demo_app()
            .oneshot(
                Request::get("/internal/v1/payment-attempts/reconciliation")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(old_scanner.status(), StatusCode::UPGRADE_REQUIRED);

        let old_release = demo_app()
            .oneshot(
                Request::post("/internal/v1/payment-attempts/release")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"settlementKind":"document","quoteId":"quote","attemptId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(old_release.status(), StatusCode::UPGRADE_REQUIRED);

        let current_scanner = demo_app()
            .oneshot(
                Request::get("/internal/v1/payment-attempts/reconciliation")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYMENT_PROTOCOL_HEADER,
                        super::PAYMENT_PROTOCOL_VERSION,
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(current_scanner.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rolling_old_payout_workers_cannot_release_prepared_transactions() {
        let body = r#"{
          "workerId":"rolling-payout-worker",
          "escrowWallet":"11111111111111111111111111111111",
          "network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          "limit":1,
          "leaseMs":60000
        }"#;
        let old_worker = demo_app()
            .oneshot(
                Request::post("/internal/v1/payout-claims/lease")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(old_worker.status(), StatusCode::UPGRADE_REQUIRED);

        let current_worker = demo_app()
            .oneshot(
                Request::post("/internal/v1/payout-claims/lease")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYOUT_PROTOCOL_HEADER,
                        super::PAYOUT_PROTOCOL_VERSION,
                    )
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(current_worker.status(), StatusCode::OK);

        let old_readiness_view = demo_app()
            .oneshot(
                Request::get("/internal/v1/payout-claims/backlog")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(old_readiness_view.status(), StatusCode::UPGRADE_REQUIRED);

        let current_readiness_view = demo_app()
            .oneshot(
                Request::get("/internal/v1/payout-claims/backlog")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .header(
                        super::PAYOUT_PROTOCOL_HEADER,
                        super::PAYOUT_PROTOCOL_VERSION,
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(current_readiness_view.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn deployment_can_disable_the_demo_payment_bypass() {
        let state = AppState::new(Store::in_memory().unwrap())
            .with_demo_open(false)
            .with_email_password_auth_enabled(true);
        let app = router(Arc::new(state));
        let response = app
            .clone()
            .oneshot(
                Request::get("/api/flash-research?queryId=q&docs=h")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let cookie = register(&app, "no-demo-open-call@example.com").await;
        let open_call = app
            .clone()
            .oneshot(
                Request::post("/api/v1/open-calls")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Which winter boots work for field research in Svalbard?",
                            "unitPrice": 700,
                            "target": 3,
                            "chatId": "no-bypass",
                            "shelf": "Svalbard field researchers",
                            "category": "travel"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        // A paid open call is a normal product route even when the old demo
        // bypass is disabled. It reaches the prepaid ledger and fails with a
        // funding conflict until the signed-in account explicitly tops up.
        assert_eq!(open_call.status(), StatusCode::CONFLICT);

        let free_call = app
            .oneshot(
                Request::post("/api/v1/open-calls")
                    .header(header::COOKIE, cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Which free community resources help new field researchers?",
                            "unitPrice": 0,
                            "target": 3,
                            "chatId": "free-call",
                            "shelf": "Field researchers",
                            "category": "travel"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        // Disabling the demo bypass must not leave a second, zero-price
        // application-ledger path behind. Every open call now requires funded
        // prepaid USDC.
        assert_eq!(free_call.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn a_paid_open_call_requires_prepaid_usdc_and_never_touches_the_internal_pot() {
        // Pure web3 (Product Decision (b)): a paid open call funds from real
        // prepaid USDC. Without a prepaid balance the post fails cleanly (409,
        // which the frontend turns into a "충전 필요" prompt) and the internal
        // KRW pot is never used as a fallback.
        let app = demo_app();
        let cookie = register(&app, "escrow@example.com").await;
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/open-calls")
                    .header(header::COOKIE, &cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Which winter boots work for field research in Svalbard?",
                            "unitPrice": 700,
                            "target": 3,
                            "chatId": "chat-escrow",
                            "shelf": "Svalbard field researchers",
                            "category": "travel"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        // No KRW fallback: the internal pot stays at zero, nothing reserved.
        let response = app
            .oneshot(
                Request::get("/api/v1/account/balance")
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["availableKrw"], 0);
        assert_eq!(body["reservedKrw"], 0);
        assert_eq!(body["availableAtomic"], "0");
        assert_eq!(body["reservedAtomic"], "0");
    }

    #[tokio::test]
    async fn prepaid_deposit_route_is_internal_only() {
        // Product Decision (e): the prepaid top-up route is posted by the pay.sh
        // gateway after it verifies the transfer on-chain, so it is gated with
        // require_internal — not a public user route.
        let app = demo_app();
        let body = json!({
            "transactionSignature": "gateway-topup-sig-1",
            "payer": "GatewayPayerWalletPlaceholder1111111111111",
            "payTo": "GatewayReceiverPlaceholder11111111111111",
            "network": "solana:devnet",
            "asset": "usdc",
            "amountAtomic": "5000000"
        })
        .to_string();
        // Without the internal token, the route is rejected outright.
        let unauthorized = app
            .clone()
            .oneshot(
                Request::post("/api/v1/prepaid/deposits")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        // With the internal token the request clears the auth gate (it then fails
        // on the demo policy's missing bundle receiver — a 409, never a 401).
        let authorized = app
            .oneshot(
                Request::post("/api/v1/prepaid/deposits")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(super::INTERNAL_TOKEN_HEADER, super::DEFAULT_INTERNAL_TOKEN)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(authorized.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn survey_submission_registers_private_context_and_one_searchable_answer() {
        let store = Store::in_memory().unwrap();
        let buyer_wallet = bs58::encode(
            SigningKey::from_bytes(&[73_u8; 32])
                .verifying_key()
                .to_bytes(),
        )
        .into_string();
        let bundle_receiver = bs58::encode(
            SigningKey::from_bytes(&[74_u8; 32])
                .verifying_key()
                .to_bytes(),
        )
        .into_string();
        let mut state = AppState::new(store.clone()).with_email_password_auth_enabled(true);
        state.payment_policy.bundle_recipient = Some(bundle_receiver.clone());
        state.payment_policy.fallback_recipient = Some(bundle_receiver.clone());
        let payment_policy = state.payment_policy.clone();
        let app = router(Arc::new(state));
        let buyer_cookie = register(&app, "survey-buyer@example.com").await;
        let buyer_id = user_id_from_me(&app, &buyer_cookie).await;
        store
            .bind_wallet_identity(&buyer_id, &buyer_wallet)
            .unwrap();
        store
            .issue_prepaid_wallet_session(
                &buyer_id,
                &buyer_wallet,
                &"ab".repeat(32),
                300_000,
                &payment_policy,
            )
            .unwrap();
        store
            .record_prepaid_deposit(
                &RecordPrepaidDepositRequest {
                    transaction_signature: "7".repeat(64),
                    payer: buyer_wallet,
                    pay_to: bundle_receiver,
                    network: payment_policy.network.clone(),
                    asset: payment_policy.asset.clone(),
                    amount_atomic: "5000000".to_owned(),
                },
                &payment_policy,
            )
            .unwrap();
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/open-calls")
                    .header(header::COOKIE, buyer_cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Which winter boots work for field research in Svalbard?",
                            "unitPrice": 1350,
                            "target": 1,
                            "chatId": "chat-survey-registration",
                            "shelf": "Svalbard field researchers",
                            "category": "travel"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let call: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let call_id = call["id"].as_str().unwrap();

        let respondent_cookie = register(&app, "survey-respondent@example.com").await;
        let profile = app
            .clone()
            .oneshot(
                Request::post("/api/v1/profile")
                    .header(header::COOKIE, &respondent_cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "handle": "survey_respondent",
                            "ageBand": "35-44",
                            "region": "seoul",
                            "household": "alone",
                            "field": "travel",
                            "years": "7-plus",
                            "speaksTo": ["travel"],
                            "autoMatch": true,
                            "agents": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(profile.status(), StatusCode::OK);

        let submitted = app
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/open-calls/{call_id}/answers"))
                    .header(header::COOKIE, &respondent_cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "answer": "In January 2025 at Longyearbyen I wore insulated Baffin boots rated to -40C. After 6 hours on packed snow my toes stayed warm, but I changed the felt liner every second day because condensation froze overnight.",
                            "interviewResponses": [{
                                "questionId": "w1",
                                "prompt": "When were you last there?",
                                "answer": "January 2025"
                            }]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(submitted.status(), StatusCode::CREATED);
        let submitted: Value =
            serde_json::from_slice(&submitted.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(submitted["order"]["answered"], 1);
        assert_eq!(
            submitted["memory"]["interviewResponses"][0]["questionId"],
            "w1"
        );

        let memory = app
            .clone()
            .oneshot(
                Request::get("/api/v1/memory")
                    .header(header::COOKIE, respondent_cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(memory.status(), StatusCode::OK);
        let memory: Value =
            serde_json::from_slice(&memory.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(memory[0]["interviewResponses"][0]["answer"], "January 2025");

        let manifest = app
            .clone()
            .oneshot(
                Request::get("/api/v1/personas/survey_respondent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(manifest.status(), StatusCode::OK);
        assert_eq!(
            manifest.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=60, stale-while-revalidate=300"
        );
        let manifest: Value =
            serde_json::from_slice(&manifest.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let memory_id = manifest["memories"][0]["id"].as_str().unwrap();
        let document_handle = manifest["memories"][0]["canonicalUrl"]
            .as_str()
            .unwrap()
            .rsplit('/')
            .next()
            .unwrap();

        let persona_memory = app
            .clone()
            .oneshot(
                Request::get(format!(
                    "/api/v1/personas/survey_respondent/memories/{memory_id}"
                ))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(persona_memory.status(), StatusCode::OK);

        let persona_document = app
            .oneshot(
                Request::get(format!(
                    "/api/v1/personas/survey_respondent/documents/{document_handle}"
                ))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(persona_document.status(), StatusCode::OK);
    }
}
