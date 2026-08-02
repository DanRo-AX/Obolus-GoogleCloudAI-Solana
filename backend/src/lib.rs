pub mod api;
pub mod domain;
pub mod quality;
pub mod search;
pub mod seed;
pub mod store;

use std::{sync::Arc, time::Duration};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
};
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};

use store::Store;

pub fn build_app(store: Store) -> Router {
    let frontend_origin = std::env::var("OPENSHELF_FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:4319".to_owned());
    let frontend_origin = HeaderValue::from_str(&frontend_origin)
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_FRONTEND_ORIGIN: {error}"));
    let cors = CorsLayer::new()
        .allow_origin(frontend_origin)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-openshelf-query-token"),
        ])
        .allow_credentials(true);

    api::router(Arc::new(api::AppState::new(store)))
        .layer(DefaultBodyLimit::max(64 * 1_024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(15),
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

pub fn demo_app() -> Router {
    build_app(Store::in_memory().expect("in-memory store should initialise"))
}
