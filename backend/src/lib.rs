pub mod api;
pub mod authority;
pub mod domain;
pub mod orchestrator;
pub mod quality;
pub mod search;
pub mod seed;
pub mod store;

use std::sync::Arc;

use axum::{
    Router,
    http::{HeaderValue, Method, header},
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use store::Store;

pub fn build_app(store: Store) -> Router {
    let frontend_origin =
        std::env::var("FRONTEND_ORIGIN").unwrap_or_else(|_| "http://localhost:4319".to_owned());
    let frontend_origin = HeaderValue::try_from(frontend_origin)
        .expect("FRONTEND_ORIGIN must be a valid HTTP header value");
    let cors = CorsLayer::new()
        .allow_origin(frontend_origin)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .allow_credentials(true);

    api::router(Arc::new(api::AppState::new(store)))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

pub fn demo_app() -> Router {
    let state = api::AppState::new(Store::in_memory().expect("in-memory store should initialise"))
        .with_demo_open(true);
    api::router(Arc::new(state))
}
