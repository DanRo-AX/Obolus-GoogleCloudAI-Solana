use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

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
        AccountControls, AiLiquidityMetrics, AuthResponse, BalanceSummary, ChainSettlementReceipt,
        ChatAnswer, CompletePayoutClaimRequest, ContributorManifest, ContributorMemoryLink,
        ContributorNotification, CorrectMemoryRequest, CreateEvidenceEdgeRequest,
        CreateOpenCallRequest, CreatePaymentBundleRequest, DisputeCase, DocumentFeedback,
        EarningsSummary, EvidenceEdge, FailPayoutClaimRequest, ForgotPasswordRequest,
        GenerateAiBaselineResponse, GenerateShelfStartersResponse, LeasePayoutClaimsRequest,
        LoginRequest, MarkNotificationsReadRequest, MemoryEntry, MemoryExport, OpenCall,
        OpenCallFundingQuote, OpenCallFundingSnapshot, OpenCallReservation, OpenDocumentsResponse,
        PaidDocument, PaymentBundleQuote, PaymentBundleSnapshot, PaymentDocumentSnapshot,
        PaymentProgress, PaymentQuote, PayoutClaim, PreparePayoutClaimRequest, PublicDocument,
        RecordChainSettlementRequest, RecoveredPaidDocument, RegisterRequest, ResetPasswordRequest,
        ResolveError, ResolveQuestionRequest, ResolveQuestionResponse, ReviewDisputeRequest,
        ReviewDocumentFeedbackRequest, ShelfStarter, SiwxPayload, SubmitAnswerRequest,
        SubmitAnswerResponse, SubmitDisputeRequest, SubmitDocumentFeedbackRequest,
        SubmitShelfStarterAnswerRequest, SubmitShelfStarterAnswerResponse, SynthesizeAnswerRequest,
        SynthesizeAnswerResponse, SynthesizePaidAnswerRequest, UpdateMemoryRequest,
        UpdatePreferencesRequest, UpsertProfileRequest, UserAccount, UserProfile,
        VerifyWalletRequest, WalletChallenge, WalletChallengeRequest, WalletSiwxLink,
    },
    orchestrator,
    search::Resolver,
    store::{AiArtifactMetadata, PaymentQuotePolicy, Store, StoreError},
};

const SESSION_COOKIE: &str = "openshelf_session";
const SESSION_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const INTERNAL_TOKEN_HEADER: &str = "x-openshelf-internal-token";
const QUERY_TOKEN_HEADER: &str = "x-openshelf-query-token";
const DEFAULT_INTERNAL_TOKEN: &str = "openshelf-local-internal";
const DEVNET_NETWORK: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

pub struct AppState {
    store: Store,
    internal_token_hash: String,
    payment_policy: PaymentQuotePolicy,
    secure_cookies: bool,
    environment: String,
    allow_demo_open: bool,
    agent_api_origin: String,
    email_endpoint: Option<String>,
    email_api_key: Option<String>,
    email_from: Option<String>,
    email_delivery_active: AtomicBool,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        let environment =
            std::env::var("OPENSHELF_ENV").unwrap_or_else(|_| "development".to_owned());
        let production = matches!(
            environment.to_ascii_lowercase().as_str(),
            "production" | "prod"
        );
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
        let agent_api_origin = std::env::var("OPENSHELF_AGENT_API_ORIGIN")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".to_owned())
            .trim_end_matches('/')
            .to_owned();
        let agent_api_url = reqwest::Url::parse(&agent_api_origin)
            .unwrap_or_else(|error| panic!("invalid OPENSHELF_AGENT_API_ORIGIN: {error}"));
        if agent_api_url.path() != "/"
            || agent_api_url.query().is_some()
            || agent_api_url.fragment().is_some()
        {
            panic!(
                "OPENSHELF_AGENT_API_ORIGIN must be an origin without a path, query, or fragment"
            );
        }
        if agent_api_url.scheme() != "https"
            && !(agent_api_url.scheme() == "http"
                && matches!(agent_api_url.host_str(), Some("127.0.0.1" | "localhost")))
        {
            panic!("OPENSHELF_AGENT_API_ORIGIN must use HTTPS unless it is a loopback URL");
        }
        if production && agent_api_url.scheme() != "https" {
            panic!("OPENSHELF_AGENT_API_ORIGIN must use HTTPS in production");
        }
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
                krw_per_usdc: env_u64("OPENSHELF_KRW_PER_USDC", 1_350),
                ttl_ms: env_u64("OPENSHELF_QUOTE_TTL_MS", 300_000),
            },
            secure_cookies,
            allow_demo_open,
            agent_api_origin,
            environment,
            email_endpoint: std::env::var("OPENSHELF_EMAIL_ENDPOINT")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            email_api_key: std::env::var("OPENSHELF_EMAIL_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            email_from: std::env::var("OPENSHELF_EMAIL_FROM")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            email_delivery_active: AtomicBool::new(false),
        }
    }

    #[cfg(test)]
    fn with_demo_open(mut self, allowed: bool) -> Self {
        self.allow_demo_open = allowed;
        self
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
        let emails = match self.store.pending_emails(25) {
            Ok(emails) => emails,
            Err(error) => {
                tracing::warn!(%error, "could not load notification email outbox");
                self.email_delivery_active.store(false, Ordering::Release);
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
                self.email_delivery_active.store(false, Ordering::Release);
                return;
            }
        };
        for email in emails {
            let response = client
                .post(endpoint)
                .bearer_auth(api_key)
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
                    let _ = self.store.mark_email_delivered(&email.id);
                }
                Ok(response) => {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();
                    let _ = self
                        .store
                        .mark_email_failed(&email.id, &format!("HTTP {status}: {body}"));
                }
                Err(error) => {
                    let _ = self.store.mark_email_failed(&email.id, &error.to_string());
                }
            }
        }
        self.email_delivery_active.store(false, Ordering::Release);
    }

    fn dispatch_pending_emails(state: Arc<Self>) {
        tokio::spawn(async move {
            state.deliver_pending_emails().await;
        });
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/password/forgot", post(forgot_password))
        .route("/api/v1/auth/password/reset", post(reset_password))
        .route("/api/v1/questions/resolve", post(resolve_question))
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
        .route("/api/v1/earnings", get(get_earnings))
        .route("/api/v1/payout-claims", get(list_payout_claims))
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
            "/internal/v1/chain-settlements",
            post(record_chain_settlement),
        )
        .route("/internal/v1/payment-bundles", post(create_payment_bundle))
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
        )
        .with_state(state)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        environment: None,
    })
}

async fn ready(State(state): State<Arc<AppState>>) -> Result<Json<HealthResponse>, ApiError> {
    state.store.ready()?;
    Ok(Json(HealthResponse {
        status: "ready",
        environment: Some(state.environment.clone()),
    }))
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
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
    state.store.check_login_allowed(&request.email)?;
    let (user, password_hash) = match state.store.password_record(&request.email) {
        Ok(record) => record,
        Err(error @ StoreError::Unauthorized(_)) => {
            state.store.record_login_failure(&request.email)?;
            return Err(error.into());
        }
        Err(error) => return Err(error.into()),
    };
    let parsed = PasswordHash::new(&password_hash).map_err(ApiError::internal)?;
    if Argon2::default()
        .verify_password(request.password.as_bytes(), &parsed)
        .is_err()
    {
        state.store.record_login_failure(&request.email)?;
        return Err(ApiError::unauthorized("invalid email or password"));
    }
    state.store.clear_login_failures(&request.email)?;
    session_response(&state, user, StatusCode::OK)
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ForgotPasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let token = random_token();
    let frontend_origin = std::env::var("OPENSHELF_FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:4319".to_owned());
    state.store.queue_password_reset(
        &request.email,
        &token_hash(&token),
        &token,
        &frontend_origin,
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
        state.store.revoke_session(&token_hash(&token))?;
    }
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::SET_COOKIE, expired_session_cookie(&state)?);
    Ok((StatusCode::NO_CONTENT, response_headers))
}

async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AuthResponse>, ApiError> {
    let user = authenticated(&state, &headers)?;
    let balance = state.store.balance(&user.id)?;
    Ok(Json(AuthResponse { user, balance }))
}

async fn resolve_question(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ResolveQuestionRequest>,
) -> Result<Json<ResolveQuestionResponse>, ApiError> {
    let question = request.question.clone();
    let resolver =
        Resolver::new(state.store.documents()?).with_evidence_edges(state.store.evidence_edges()?);
    let mut response = resolver.resolve(request)?;
    let payment_access_token = random_token();
    state.store.record_resolution(
        &question,
        &response,
        Some(&token_hash(&payment_access_token)),
    )?;
    response.payment_access_token = Some(payment_access_token);
    Ok(Json(response))
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

    let generated = orchestrator::generate_ai_baseline(&question)
        .await
        .map_err(|error| ApiError::validation(&error.to_string()))?;
    let Some(generated) = generated else {
        return Ok(Json(GenerateAiBaselineResponse {
            status: "unavailable",
            baseline: None,
        }));
    };
    let ttl_ms = std::env::var("OPENSHELF_AI_BASELINE_TTL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(6 * 60 * 60 * 1_000);
    let baseline = state.store.record_ai_baseline(
        &query_id,
        &access_token_hash,
        &generated.draft,
        &AiArtifactMetadata {
            model: &generated.model,
            mode: &generated.mode,
            policy_version: orchestrator::AI_BASELINE_POLICY_VERSION,
            ttl_ms,
        },
    )?;
    Ok(Json(GenerateAiBaselineResponse {
        status: "generated",
        baseline: Some(baseline),
    }))
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
        StoreError::Conflict("complete onboarding before building your shelf".to_owned())
    })?;
    let generated = orchestrator::generate_shelf_starters(&profile.field, &profile.speaks_to)
        .await
        .map_err(|error| ApiError::validation(&error.to_string()))?;
    let Some(generated) = generated else {
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
        orchestrator::AI_BASELINE_POLICY_VERSION,
        24 * 60 * 60 * 1_000,
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
    let canonical_request = SynthesizeAnswerRequest {
        query_id: request.query_id.clone(),
        question,
        citations,
    };
    let response = orchestrator::synthesize(&canonical_request)
        .await
        .map_err(|error| ApiError::validation(&error.to_string()))?;
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
    let call = state.store.create_open_call(&user.id, &request)?;
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
    response_headers.insert(header::SET_COOKIE, expired_session_cookie(&state)?);
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
        "Verify this Pay.sh wallet as your OPENSHELF payout wallet.",
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
                "description": "Verify a Pay.sh wallet for OPENSHELF contributor payouts",
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
    Ok(Json(state.store.payment_quote(
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

async fn create_payment_bundle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePaymentBundleRequest>,
) -> Result<Json<PaymentBundleQuote>, ApiError> {
    require_internal(&state, &headers)?;
    let access_token = query_access_token(&headers)?;
    Ok(Json(state.store.create_payment_bundle(
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
    Ok(Json(state.store.lease_payout_claims(
        &request.worker_id,
        &request.escrow_wallet,
        &request.network,
        request.limit,
        request.lease_ms,
    )?))
}

async fn prepare_payout_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<PreparePayoutClaimRequest>,
) -> Result<Json<PayoutClaim>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.prepare_payout_claim(
        &id,
        &request.worker_id,
        &request.transaction_signature,
        &request.signed_transaction_base64,
        &request.recent_blockhash,
        request.last_valid_block_height,
    )?))
}

async fn complete_payout_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<CompletePayoutClaimRequest>,
) -> Result<Json<PayoutClaim>, ApiError> {
    require_internal(&state, &headers)?;
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

fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(ApiError::internal)?
        .to_string())
}

fn session_response(
    state: &AppState,
    user: UserAccount,
    status: StatusCode,
) -> Result<(StatusCode, HeaderMap, Json<AuthResponse>), ApiError> {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    state.store.create_session(
        &user.id,
        &token_hash(&token),
        now_ms().saturating_add(SESSION_TTL_MS),
    )?;
    let balance = state.store.balance(&user.id)?;
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
    Ok((status, headers, Json(AuthResponse { user, balance })))
}

fn expired_session_cookie(state: &AppState) -> Result<HeaderValue, ApiError> {
    let mut cookie = format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
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

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn env_bool(name: &str, fallback: bool) -> bool {
    std::env::var(name)
        .ok()
        .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(fallback)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time is before Unix epoch")
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDocumentsQuery {
    query_id: String,
    docs: String,
    payer: Option<String>,
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
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{demo_app, store::Store};

    use super::{AppState, BASE64_STANDARD, QUERY_TOKEN_HEADER, router};

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

    #[tokio::test]
    async fn registration_creates_an_authenticated_sandbox_account() {
        let app = demo_app();
        let cookie = register(&app, "buyer@example.com").await;
        let response = app
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
        assert_eq!(body["user"]["email"], "buyer@example.com");
        assert_eq!(body["balance"]["availableKrw"], 100_000);
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
    async fn readiness_checks_the_store() {
        let response = demo_app()
            .oneshot(Request::get("/readyz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
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
            "/internal/v1/payment-bundles/bundle",
            "/internal/v1/payment-bundles/bundle/snapshot",
        ] {
            let response = demo_app()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[tokio::test]
    async fn deployment_can_disable_the_demo_payment_bypass() {
        let state = AppState::new(Store::in_memory().unwrap()).with_demo_open(false);
        let response = router(Arc::new(state))
            .oneshot(
                Request::get("/api/flash-research?queryId=q&docs=h")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn a_created_call_reserves_the_full_budget() {
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
        assert_eq!(response.status(), StatusCode::CREATED);
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
        assert_eq!(body["availableKrw"], 97_900);
        assert_eq!(body["reservedKrw"], 2_100);
    }

    #[tokio::test]
    async fn survey_submission_registers_private_context_and_one_searchable_answer() {
        let app = demo_app();
        let buyer_cookie = register(&app, "survey-buyer@example.com").await;
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/open-calls")
                    .header(header::COOKIE, buyer_cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "question": "Which winter boots work for field research in Svalbard?",
                            "unitPrice": 700,
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
