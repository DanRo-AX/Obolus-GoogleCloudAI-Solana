pub mod api;
pub mod authority;
pub mod domain;
pub mod orchestrator;
pub mod quality;
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
    let frontend_origin = std::env::var("OPENSHELF_FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:4319".to_owned());
    let production = std::env::var("OPENSHELF_ENV").ok().is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "production" | "prod"
        )
    });
    if production && !frontend_origin.starts_with("https://") {
        panic!("OPENSHELF_FRONTEND_ORIGIN must use HTTPS in production");
    }
    let frontend_origin = HeaderValue::from_str(&frontend_origin)
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_FRONTEND_ORIGIN: {error}"));
    let cors = CorsLayer::new()
        .allow_origin(frontend_origin)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-openshelf-query-token"),
        ])
        .allow_credentials(true);

    api::router(Arc::new(api::AppState::new(store)))
        .layer(from_fn(default_response_headers))
        .layer(DefaultBodyLimit::max(64 * 1_024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(15),
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
    build_app(Store::in_memory().expect("in-memory store should initialise"))
}
