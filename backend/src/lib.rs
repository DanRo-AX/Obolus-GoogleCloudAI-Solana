pub mod api;
pub mod domain;
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
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("http://localhost:4319"))
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .allow_credentials(true);

    api::router(Arc::new(api::AppState::new(store)))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

pub fn demo_app() -> Router {
    build_app(Store::in_memory().expect("in-memory store should initialise"))
}
