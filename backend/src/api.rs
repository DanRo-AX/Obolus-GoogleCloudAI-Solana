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
    routing::{delete, get, post},
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    domain::{
        AccountControls, AuthResponse, BalanceSummary, ChainSettlementReceipt, ChatAnswer,
        CreateOpenCallRequest, DisputeCase, EarningsSummary, LoginRequest, MemoryEntry, OpenCall,
        OpenDocumentsResponse, PaidDocument, PaymentQuote, RecordChainSettlementRequest,
        RegisterRequest, ResolveError, ResolveQuestionRequest, ResolveQuestionResponse,
        ReviewDisputeRequest, SubmitAnswerRequest, SubmitAnswerResponse, SubmitDisputeRequest,
        UpdatePreferencesRequest, UpsertProfileRequest, UserAccount, UserProfile,
    },
    search::Resolver,
    store::{PaymentQuotePolicy, Store, StoreError},
};

const SESSION_COOKIE: &str = "openshelf_session";
const SESSION_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const INTERNAL_TOKEN_HEADER: &str = "x-openshelf-internal-token";
const DEFAULT_INTERNAL_TOKEN: &str = "openshelf-local-internal";
const DEVNET_NETWORK: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

pub struct AppState {
    store: Store,
    internal_token_hash: String,
    payment_policy: PaymentQuotePolicy,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        let internal_token = std::env::var("OPENSHELF_INTERNAL_TOKEN")
            .unwrap_or_else(|_| DEFAULT_INTERNAL_TOKEN.to_owned());
        Self {
            store,
            internal_token_hash: token_hash(&internal_token),
            payment_policy: PaymentQuotePolicy {
                fallback_recipient: std::env::var("OPENSHELF_DEFAULT_RECEIVER")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                network: std::env::var("OPENSHELF_X402_NETWORK")
                    .unwrap_or_else(|_| DEVNET_NETWORK.to_owned()),
                asset: std::env::var("OPENSHELF_X402_ASSET")
                    .unwrap_or_else(|_| DEVNET_USDC.to_owned()),
                krw_per_usdc: env_u64("OPENSHELF_KRW_PER_USDC", 1_350),
                ttl_ms: env_u64("OPENSHELF_QUOTE_TTL_MS", 300_000),
            },
        }
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/questions/resolve", post(resolve_question))
        .route(
            "/api/v1/open-calls",
            get(list_open_calls).post(create_open_call),
        )
        .route("/api/v1/open-calls/{id}/answers", post(submit_answer))
        .route("/api/v1/open-calls/{id}", delete(cancel_open_call))
        .route("/api/v1/chats/{id}/answers", get(chat_answers))
        .route("/api/v1/memory", get(list_memory))
        .route("/api/v1/memory/{id}/dispute", post(submit_dispute))
        .route("/api/v1/disputes/me", get(my_dispute))
        .route("/api/v1/admin/disputes", get(list_disputes))
        .route("/api/v1/admin/disputes/{id}/review", post(review_dispute))
        .route("/api/v1/account-controls", get(account_controls))
        .route("/api/v1/account/balance", get(get_balance))
        .route("/api/v1/account", delete(delete_account))
        .route("/api/v1/profile", get(get_profile).post(upsert_profile))
        .route("/api/v1/profile/preferences", post(update_preferences))
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
    Json(HealthResponse { status: "ok" })
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
    validate_password(&request.password)?;
    let password_hash = hash_password(&request.password)?;
    let user = state.store.register_user(&request.email, &password_hash)?;
    session_response(&state.store, user, StatusCode::CREATED)
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (user, password_hash) = state.store.password_record(&request.email)?;
    let parsed = PasswordHash::new(&password_hash).map_err(ApiError::internal)?;
    Argon2::default()
        .verify_password(request.password.as_bytes(), &parsed)
        .map_err(|_| ApiError::unauthorized("invalid email or password"))?;
    session_response(&state.store, user, StatusCode::OK)
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(token) = session_token(&headers) {
        state.store.revoke_session(&token_hash(&token))?;
    }
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("openshelf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"),
    );
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
    let resolver = Resolver::new(state.store.documents()?);
    let response = resolver.resolve(request)?;
    state.store.record_resolution(&question, &response)?;
    Ok(Json(response))
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
    let response = state.store.submit_answer(&id, &user.id, &request.answer)?;
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

async fn review_dispute(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ReviewDisputeRequest>,
) -> Result<Json<DisputeCase>, ApiError> {
    let user = authenticated(&state, &headers)?;
    Ok(Json(state.store.review_dispute(&user.id, &id, &request)?))
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

async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = authenticated(&state, &headers)?;
    state.store.delete_account(&user.id)?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("openshelf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"),
    );
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
    store: &Store,
    user: UserAccount,
    status: StatusCode,
) -> Result<(StatusCode, HeaderMap, Json<AuthResponse>), ApiError> {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    store.create_session(
        &user.id,
        &token_hash(&token),
        now_ms().saturating_add(SESSION_TTL_MS),
    )?;
    let balance = store.balance(&user.id)?;
    let cookie = format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        SESSION_TTL_MS / 1_000
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(ApiError::internal)?,
    );
    Ok((status, headers, Json(AuthResponse { user, balance })))
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

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
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

    fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: error.to_string(),
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
        let (status, code) = match error {
            StoreError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            StoreError::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_request"),
            StoreError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            StoreError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            StoreError::DocumentNotQuoted => (StatusCode::FORBIDDEN, "document_not_quoted"),
            StoreError::Database(_) | StoreError::LockPoisoned => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
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
    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::demo_app;

    async fn register(app: &axum::Router, email: &str) -> String {
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({"email": email, "password": "correct-horse-42"}).to_string(),
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
}
