pub mod api;
pub mod authority;
pub mod db;
pub mod domain;
pub mod environment;
pub mod orchestrator;
pub mod public_evidence;
pub mod quality;
pub mod rollback_audit;
pub mod rollback_sweep;
pub mod search;
pub mod seed;
pub mod settlement_invoice;
pub mod store;

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{Next, from_fn, from_fn_with_state},
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
            HeaderName::from_static("x-obulus-client"),
            HeaderName::from_static("x-obulus-instance"),
        ])
        .allow_credentials(true);

    api::AppState::start_email_delivery_loop(&state);
    api::router(state.clone())
        .layer(from_fn_with_state(state, system_activity))
        .layer(from_fn(default_response_headers))
        .layer(DefaultBodyLimit::max(64 * 1_024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(22),
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn system_activity(
    axum::extract::State(state): axum::extract::State<Arc<api::AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let classified = classify_system_activity(request.method(), request.uri().path());
    let source = safe_event_label(
        request
            .headers()
            .get("x-obulus-client")
            .and_then(|value| value.to_str().ok()),
        classified.map_or("api", |(_, _, fallback)| fallback),
        48,
    );
    let instance = safe_event_label(
        request
            .headers()
            .get("x-obulus-instance")
            .and_then(|value| value.to_str().ok()),
        "",
        64,
    );
    let started = Instant::now();
    let response = next.run(request).await;
    if let Some((stage, action, _)) = classified {
        let elapsed = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        if let Err(error) = state.record_system_event(
            &source,
            &instance,
            stage,
            action,
            response.status().as_u16(),
            elapsed,
        ) {
            tracing::warn!(%error, "could not persist privacy-safe system activity");
        }
    }
    response
}

fn safe_event_label(value: Option<&str>, fallback: &str, max: usize) -> String {
    value
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= max
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .unwrap_or(fallback)
        .to_owned()
}

/// Reduce request paths to a finite operational vocabulary. Dynamic IDs,
/// prompts, wallet addresses and paid document handles are never persisted.
fn classify_system_activity(
    method: &Method,
    path: &str,
) -> Option<(&'static str, &'static str, &'static str)> {
    if method == Method::OPTIONS
        || path == "/healthz"
        || path == "/readyz"
        || path.starts_with("/api/v1/admin/")
    {
        return None;
    }
    let fallback = if path.starts_with("/internal/") {
        "cloud-worker"
    } else {
        "api"
    };
    let mutates_state = matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    let classified = if path.contains("/questions/resolve") && mutates_state {
        ("retrieval", "resolve_question")
    } else if path.contains("/answers/synthesize") && mutates_state {
        ("generation", "synthesize_answer")
    } else if (path.contains("/open-calls") || path.contains("/shelf-starters")) && mutates_state {
        ("coverage", "human_open_call")
    } else if (path.contains("/memory") || path.contains("/documents/")) && mutates_state {
        ("memory", "memory_append")
    } else if (path.contains("payment")
        || path.contains("settlement")
        || path.contains("pay-sh")
        || path.contains("payout"))
        && mutates_state
    {
        ("settlement", "x402_settlement")
    } else if path.contains("/research-jobs") && mutates_state {
        ("orchestration", "research_job")
    } else {
        return None;
    };
    Some((classified.0, classified.1, fallback))
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

#[cfg(test)]
mod tests {
    use super::classify_system_activity;
    use axum::http::Method;

    #[test]
    fn activity_log_ignores_read_only_polling() {
        assert_eq!(
            classify_system_activity(&Method::GET, "/api/v1/open-calls"),
            None
        );
        assert_eq!(
            classify_system_activity(&Method::GET, "/api/v1/memory"),
            None
        );
        assert_eq!(
            classify_system_activity(&Method::GET, "/api/v1/admin/data-pipeline"),
            None
        );
    }

    #[test]
    fn activity_log_keeps_material_pipeline_transitions() {
        assert_eq!(
            classify_system_activity(&Method::POST, "/api/v1/open-calls"),
            Some(("coverage", "human_open_call", "api"))
        );
        assert_eq!(
            classify_system_activity(&Method::POST, "/api/v1/memory"),
            Some(("memory", "memory_append", "api"))
        );
        assert_eq!(
            classify_system_activity(&Method::POST, "/api/v1/questions/resolve"),
            Some(("retrieval", "resolve_question", "api"))
        );
    }
}
