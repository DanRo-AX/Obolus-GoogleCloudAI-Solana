use std::net::SocketAddr;

use openshelf_api::{build_app, store::Store};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("openshelf_api=info,tower_http=info")),
        )
        .init();

    let bind = std::env::var("OPENSHELF_BIND").unwrap_or_else(|_| "0.0.0.0:8787".to_owned());
    let address: SocketAddr = bind
        .parse()
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_BIND {bind:?}: {error}"));

    let database_path =
        std::env::var("OPENSHELF_DATABASE").unwrap_or_else(|_| "openshelf.db".to_owned());
    let store = Store::open(&database_path)
        .unwrap_or_else(|error| panic!("failed to open database {database_path:?}: {error}"));
    let app = build_app(store);
    let listener = TcpListener::bind(address)
        .await
        .unwrap_or_else(|error| panic!("failed to bind {address}: {error}"));

    info!(%address, %database_path, "OPENSHELF API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server failed");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
