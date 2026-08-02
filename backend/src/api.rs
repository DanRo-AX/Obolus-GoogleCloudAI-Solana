use std::sync::Arc;

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    domain::{
        AccountControls, AuthResponse, BalanceSummary, ChainSettlementReceipt, ChatAnswer,
        ContributorManifest, CorrectMemoryRequest, CreateEvidenceEdgeRequest,
        CreateOpenCallRequest, DisputeCase, DocumentFeedback, EarningsSummary, EvidenceEdge,
        LoginRequest, MemoryEntry, MemoryExport, OpenCall, OpenDocumentsResponse, PaidDocument,
        PaymentProgress, PaymentQuote, PublicDocument, RecordChainSettlementRequest,
        RecoveredPaidDocument, RegisterRequest, ResolveError, ResolveQuestionRequest,
        ResolveQuestionResponse, ReviewDisputeRequest, ReviewDocumentFeedbackRequest,
        SubmitAnswerRequest, SubmitAnswerResponse, SubmitDisputeRequest,
        SubmitDocumentFeedbackRequest, SynthesizeAnswerRequest, SynthesizeAnswerResponse,
        SynthesizePaidAnswerRequest, UpdateMemoryRequest, UpdatePreferencesRequest,
        UpsertProfileRequest, UserAccount, UserProfile, VerifyWalletRequest, WalletChallenge,
        WalletChallengeRequest,
    },
    orchestrator,
    search::Resolver,
    store::{PaymentQuotePolicy, Store, StoreError},
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
}

impl AppState {
    pub fn new(store: Store) -> Self {
        let environment =
            std::env::var("OPENSHELF_ENV").unwrap_or_else(|_| "development".to_owned());
        let production = matches!(
            environment.to_ascii_lowercase().as_str(),
            "production" | "prod"
        );
        let configured_internal_token = std::env::var("OPENSHELF_INTERNAL_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty());
        if production
            && configured_internal_token
                .as_deref()
                .is_none_or(|value| value == DEFAULT_INTERNAL_TOKEN)
        {
            panic!("OPENSHELF_INTERNAL_TOKEN must be set to a non-default secret in production");
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
        Self {
            store,
            internal_token_hash: token_hash(&internal_token),
            payment_policy: PaymentQuotePolicy {
                fallback_recipient: std::env::var("OPENSHELF_DEFAULT_RECEIVER")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                network,
                asset,
                krw_per_usdc: env_u64("OPENSHELF_KRW_PER_USDC", 1_350),
                ttl_ms: env_u64("OPENSHELF_QUOTE_TTL_MS", 300_000),
            },
            secure_cookies: env_bool("OPENSHELF_SECURE_COOKIES", production),
            allow_demo_open: env_bool("OPENSHELF_ALLOW_DEMO_OPEN", !production),
            environment,
        }
    }

    #[cfg(test)]
    fn with_demo_open(mut self, allowed: bool) -> Self {
        self.allow_demo_open = allowed;
        self
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
        .route("/api/v1/questions/resolve", post(resolve_question))
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
        .route("/api/v1/open-calls/{id}/answers", post(submit_answer))
        .route("/api/v1/open-calls/{id}", delete(cancel_open_call))
        .route("/api/v1/chats/{id}/answers", get(chat_answers))
        .route("/api/v1/memory", get(list_memory))
        .route("/api/v1/memory/{id}", patch(update_memory))
        .route("/api/v1/memory/{id}/corrections", post(correct_memory))
        .route("/api/v1/memory/{id}/dispute", post(submit_dispute))
        .route("/api/v1/disputes/me", get(my_dispute))
        .route("/api/v1/admin/disputes", get(list_disputes))
        .route("/api/v1/admin/evidence-edges", post(create_evidence_edge))
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
        .route("/api/v1/documents/{handle}", get(public_document))
        .route("/api/v1/profile", get(get_profile).post(upsert_profile))
        .route("/api/v1/profile/preferences", post(update_preferences))
        .route(
            "/api/v1/profile/wallet/challenge",
            post(create_wallet_challenge),
        )
        .route("/api/v1/profile/wallet/verify", post(verify_wallet))
        .route("/api/v1/earnings", get(get_earnings))
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
            "/internal/v1/chain-settlements",
            post(record_chain_settlement),
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

async fn synthesize_answer(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SynthesizePaidAnswerRequest>,
) -> Result<Json<SynthesizeAnswerResponse>, ApiError> {
    let (question, citations) = state
        .store
        .opened_evidence(&request.query_id, &request.handles)?;
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
    Ok(Json(response))
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
) -> Result<Json<RecoveredPaidDocument>, ApiError> {
    let access_token = query_access_token(&headers)?;
    Ok(Json(state.store.recover_paid_document(
        &query_id,
        &handle,
        &query.payer,
        &token_hash(access_token),
    )?))
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
    Ok((StatusCode::CREATED, Json(call)))
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
) -> Result<Json<ContributorManifest>, ApiError> {
    Ok(Json(state.store.contributor_manifest(&handle)?))
}

async fn public_document(
    State(state): State<Arc<AppState>>,
    Path(handle): Path<String>,
) -> Result<Json<PublicDocument>, ApiError> {
    Ok(Json(state.store.public_document(&handle)?))
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
    Ok(Json(state.store.upsert_profile(&user.id, &request)?))
}

async fn update_preferences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpdatePreferencesRequest>,
) -> Result<Json<UserProfile>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.update_preferences(&user.id, &request)?))
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

async fn get_earnings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<EarningsSummary>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.earnings(&user.id)?))
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
) -> Result<Json<PaidDocument>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.paid_document(&id)?))
}

async fn record_chain_settlement(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RecordChainSettlementRequest>,
) -> Result<Json<ChainSettlementReceipt>, ApiError> {
    require_internal(&state, &headers)?;
    Ok(Json(state.store.record_chain_settlement(&request)?))
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
            StoreError::Database(_) | StoreError::LockPoisoned => {
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
    use ed25519_dalek::{Signer, SigningKey};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{demo_app, store::Store};

    use super::{AppState, QUERY_TOKEN_HEADER, router};

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
        let response = demo_app()
            .oneshot(
                Request::get("/internal/v1/payment-quotes/query/document")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
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
    }
}
