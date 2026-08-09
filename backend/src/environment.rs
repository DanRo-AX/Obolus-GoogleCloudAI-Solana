use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const MIN_REASONABLE_UNIX_MS: u64 = 1_704_067_200_000; // 2024-01-01 UTC

struct MonotonicClock(AtomicU64);

impl MonotonicClock {
    const fn new() -> Self {
        Self(AtomicU64::new(0))
    }

    fn observe(&self, observed: u64) -> u64 {
        self.0.fetch_max(observed, Ordering::AcqRel).max(observed)
    }

    fn last(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }
}

static UNIX_CLOCK: MonotonicClock = MonotonicClock::new();

/// Classify the deployment mode once and fail closed on misspellings. A typo
/// such as `prodution` must not silently enable demo data, insecure cookies,
/// or the local SQLite ledger.
pub fn managed_environment(value: &str) -> Result<bool, &'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "production" | "prod" | "staging" | "stage" => Ok(true),
        "development" | "dev" | "local" | "test" => Ok(false),
        _ => Err(
            "OPENSHELF_ENV must be production, prod, staging, stage, development, dev, local, or test",
        ),
    }
}

pub fn managed_runtime_environment(value: &str) -> Result<bool, &'static str> {
    let configured = managed_environment(value)?;
    let cloud_run = [
        "K_SERVICE",
        "K_REVISION",
        "K_CONFIGURATION",
        "CLOUD_RUN_JOB",
        "CLOUD_RUN_EXECUTION",
    ]
    .iter()
    .any(|name| {
        std::env::var(name)
            .ok()
            .is_some_and(|marker| !marker.trim().is_empty())
    });
    Ok(configured || cloud_run)
}

#[cfg(test)]
fn managed_environment_on_platform(
    value: &str,
    managed_platform: bool,
) -> Result<bool, &'static str> {
    Ok(managed_environment(value)? || managed_platform)
}

pub fn boolean_value(name: &str, value: Option<&str>, fallback: bool) -> Result<bool, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(fallback);
    };
    match value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(format!("{name} must be an explicit boolean")),
    }
}

pub fn unsigned_integer_value(
    name: &str,
    value: Option<&str>,
    fallback: u64,
) -> Result<u64, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(fallback);
    };
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("{name} must be an unsigned base-10 integer"));
    }
    value
        .parse::<u64>()
        .map_err(|_| format!("{name} is outside the u64 range"))
}

pub fn validate_system_clock() -> Result<(), &'static str> {
    let observed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch")?
        .as_millis()
        .min(u64::MAX as u128) as u64;
    if observed < MIN_REASONABLE_UNIX_MS {
        return Err("system clock is earlier than 2024-01-01 UTC");
    }
    UNIX_CLOCK.observe(observed);
    Ok(())
}

/// Never let an in-process wall-clock rollback extend a capability or lease.
/// Startup rejects an implausible initial clock; after startup this freezes at
/// the highest observation until real time catches up.
pub fn monotonic_unix_time_ms() -> u64 {
    let last = UNIX_CLOCK.last();
    let observed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(last);
    UNIX_CLOCK.observe(observed)
}

#[cfg(test)]
mod tests {
    use super::{
        MonotonicClock, boolean_value, managed_environment, managed_environment_on_platform,
        monotonic_unix_time_ms, unsigned_integer_value, validate_system_clock,
    };

    #[test]
    fn staging_gets_every_managed_safety_guard_and_typos_fail_closed() {
        assert_eq!(managed_environment("staging"), Ok(true));
        assert_eq!(managed_environment("PROD"), Ok(true));
        assert_eq!(managed_environment("development"), Ok(false));
        assert!(managed_environment("prodution").is_err());
        assert!(managed_environment("").is_err());
    }

    #[test]
    fn a_managed_platform_cannot_be_downgraded_by_a_development_label() {
        assert_eq!(
            managed_environment_on_platform("development", true),
            Ok(true)
        );
        assert_eq!(managed_environment_on_platform("test", true), Ok(true));
        assert_eq!(managed_environment_on_platform("local", false), Ok(false));
    }

    #[test]
    fn malformed_explicit_flags_and_numbers_never_turn_into_defaults() {
        assert_eq!(boolean_value("FLAG", None, true), Ok(true));
        assert_eq!(boolean_value("FLAG", Some("false"), true), Ok(false));
        assert!(boolean_value("FLAG", Some("flase"), true).is_err());
        assert_eq!(unsigned_integer_value("TTL", None, 30_000), Ok(30_000));
        assert_eq!(
            unsigned_integer_value("TTL", Some("60000"), 30_000),
            Ok(60_000)
        );
        assert!(unsigned_integer_value("TTL", Some("60000ms"), 30_000).is_err());
        assert!(unsigned_integer_value("TTL", Some("-1"), 30_000).is_err());
    }

    #[test]
    fn runtime_clock_is_plausible_and_never_moves_backward_in_process() {
        validate_system_clock().unwrap();
        let first = monotonic_unix_time_ms();
        let second = monotonic_unix_time_ms();
        assert!(first >= 1_704_067_200_000);
        assert!(second >= first);
        let simulated = MonotonicClock::new();
        assert_eq!(simulated.observe(10_000), 10_000);
        assert_eq!(simulated.observe(1), 10_000);
        assert_eq!(simulated.observe(10_001), 10_001);
    }
}
