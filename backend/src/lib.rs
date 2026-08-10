pub mod api;
pub mod authority;
pub mod db;
pub mod domain;
pub mod environment;
pub mod orchestrator;
pub mod quality;
pub mod rollback_audit;
pub mod rollback_sweep;
pub mod search;
pub mod seed;
pub mod store;

use std::{sync::Arc, time::Duration};

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{Next, from_fn},
    response::Response,
};
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};

use store::Store;

pub fn build_app(store: Store) -> Router {
    build_app_with_state(Arc::new(api::AppState::new(store)))
}

fn build_app_with_state(state: Arc<api::AppState>) -> Router {
    let frontend_origin = HeaderValue::from_str(state.frontend_origin())
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_FRONTEND_ORIGIN: {error}"));
    let cors = CorsLayer::new()
        .allow_origin(frontend_origin)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-openshelf-query-token"),
            HeaderName::from_static("x-openshelf-wallet-session"),
        ])
        .allow_credentials(true);

    api::AppState::start_email_delivery_loop(&state);
    api::router(state)
        .layer(from_fn(default_response_headers))
        .layer(DefaultBodyLimit::max(64 * 1_024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(22),
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn default_response_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

pub fn demo_app() -> Router {
    let state = api::AppState::new(Store::in_memory().expect("in-memory store should initialise"))
        .with_email_password_auth_enabled(true);
    build_app_with_state(Arc::new(state))
}
