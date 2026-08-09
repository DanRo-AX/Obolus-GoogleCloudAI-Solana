use std::net::SocketAddr;

use openshelf_api::{
    build_app,
    environment::{managed_runtime_environment, validate_system_clock},
    store::Store,
};
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

    validate_system_clock().unwrap_or_else(|error| panic!("invalid system clock: {error}"));

    let bind = std::env::var("OPENSHELF_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_owned());
    let address: SocketAddr = bind
        .parse()
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_BIND {bind:?}: {error}"));
    if !address.ip().is_loopback() {
        let internal_token = std::env::var("OPENSHELF_INTERNAL_TOKEN").unwrap_or_default();
        if internal_token.len() < 32
            || ["openshelf-local-internal", "change-this-before-deploy"]
                .contains(&internal_token.as_str())
        {
            panic!(
                "a non-loopback OPENSHELF_BIND requires an OPENSHELF_INTERNAL_TOKEN of at least 32 characters"
            );
        }
    }

    let environment = std::env::var("OPENSHELF_ENV").unwrap_or_else(|_| "development".to_owned());
    let production = managed_runtime_environment(&environment)
        .unwrap_or_else(|error| panic!("invalid deployment environment: {error}"));
    let configured_database = std::env::var("OPENSHELF_DATABASE").ok();
    let database_path = validated_database_target(production, configured_database.as_deref())
        .unwrap_or_else(|error| panic!("invalid OPENSHELF_DATABASE: {error}"));
    let database_engine = if database_path.starts_with("postgres://")
        || database_path.starts_with("postgresql://")
        || database_path.starts_with("host=")
    {
        "postgresql"
    } else {
        "sqlite"
    };
    let store = Store::open(&database_path)
        .unwrap_or_else(|error| panic!("failed to open configured database: {error}"));
    let app = build_app(store);
    let listener = TcpListener::bind(address)
        .await
        .unwrap_or_else(|error| panic!("failed to bind {address}: {error}"));

    info!(%address, database_engine, "OPENSHELF API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server failed");
}

fn validated_database_target(
    production: bool,
    configured_database: Option<&str>,
) -> Result<String, &'static str> {
    let configured_database = configured_database
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if production && configured_database.is_none() {
        return Err("a PostgreSQL connection string is required in production");
    }
    let database = configured_database.unwrap_or("openshelf.db");
    let postgres = database.starts_with("postgres://")
        || database.starts_with("postgresql://")
        || database.starts_with("host=");
    if production && !postgres {
        return Err("production cannot use a process-local SQLite ledger");
    }
    Ok(database.to_owned())
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

#[cfg(test)]
mod tests {
    use super::validated_database_target;

    #[test]
    fn production_never_falls_back_to_an_ephemeral_sqlite_ledger() {
        assert!(validated_database_target(true, None).is_err());
        assert!(validated_database_target(true, Some("  ")).is_err());
        assert!(validated_database_target(true, Some("/data/openshelf.db")).is_err());
        assert_eq!(
            validated_database_target(
                true,
                Some("host=/cloudsql/project:region:instance dbname=obolus")
            )
            .unwrap(),
            "host=/cloudsql/project:region:instance dbname=obolus"
        );
        assert_eq!(
            validated_database_target(false, None).unwrap(),
            "openshelf.db"
        );
    }
}
