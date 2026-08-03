use std::{
    collections::HashSet,
    path::Path,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    db::{self, Connection, OptionalExtension, Transaction},
    domain::{
        AccountControls, AiBaseline, AiBaselineDraft, AiLiquidityMetrics, AnswerIssue,
        BalanceSummary, ChainSettlementReceipt, ChatAnswer, Citation, ContributorManifest,
        ContributorMemoryLink, ContributorNotification, CorrectMemoryRequest,
        CreateEvidenceEdgeRequest, CreateOpenCallRequest, CreatePaymentBundleRequest,
        DemographicBands, DisputeCase, Document, DocumentFeedback, EarningEvent, EarningsSummary,
        EvidenceContribution, EvidenceEdge, InterviewResponse, LiquidityState, MemoryAccessEvent,
        MemoryEntry, MemoryExport, OpenCall, OpenCallFundingQuote, OpenCallFundingSnapshot,
        OpenCallReservation, OpenDocumentsResponse, PaidDocument, PayShResource,
        PaymentBundleQuote, PaymentBundleSnapshot, PaymentDocumentProgress,
        PaymentDocumentSnapshot, PaymentProgress, PaymentQuote, PayoutClaim, PrepaidBalance,
        PrepaidWalletSession, PublicDocument, RecordChainSettlementRequest, RecoveredPaidDocument,
        ResearchJobPlan, ResearchJobStatus, ResolveQuestionResponse, ReviewDisputeRequest,
        ReviewDocumentFeedbackRequest, SearchFilters, Settlement, ShelfStarter, ShelfStarterDraft,
        SiwxPayload, SubmitAnswerResponse, SubmitDocumentFeedbackRequest,
        SubmitShelfStarterAnswerResponse, UpdatePreferencesRequest, UpsertProfileRequest,
        UserAccount, UserProfile, WalletChallenge,
    },
    params, quality, seed,
};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);
const STRIKE_LIMIT: usize = 3;
const AUTO_MATCH_STRIKE_LIMIT: usize = 2;
const PAYOUT_HOLD_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
const ANSWER_RESERVATION_TTL_MS: u64 = 10 * 60 * 1_000;
const AGENT_MATCH_THRESHOLD: f32 = 0.82;
const SIGNUP_CREDIT_KRW: u64 = 100_000;
const LOGIN_FAILURE_WINDOW_MS: u64 = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS: u64 = 15 * 60 * 1_000;
const MAX_PREPAID_TOP_UP_ATOMIC: u64 = 1_000 * 1_000_000;
const QUERY_TOKEN_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const LOGIN_FAILURE_LIMIT: u64 = 5;
const CATEGORY_IDS: &[&str] = &[
    "life",
    "food",
    "family",
    "health",
    "business",
    "sales",
    "engineering",
    "education",
    "sports",
    "travel",
    "money",
];
const AGE_BANDS: &[&str] = &["under-25", "25-34", "35-44", "45-54", "55-plus"];
const REGIONS: &[&str] = &["seoul", "gyeonggi", "metro", "town", "abroad"];
const HOUSEHOLDS: &[&str] = &["alone", "partner", "kids", "parents", "shared"];
const YEAR_BANDS: &[&str] = &["under-1", "1-3", "3-7", "7-plus"];
const USDC_ATOMIC_UNITS: u128 = 1_000_000;
const PAY_SH_PRICE_BANDS_KRW: &[u64] = &[5, 10, 15, 25, 100, 300, 500, 700, 800, 1_000];
const CURRENT_CONSENT_VERSION: &str = "openshelf.consent.v1";

#[derive(Debug, Clone)]
pub struct PaymentQuotePolicy {
    pub fallback_recipient: Option<String>,
    pub bundle_recipient: Option<String>,
    pub network: String,
    pub asset: String,
    pub krw_per_usdc: u64,
    pub ttl_ms: u64,
}

pub struct PayShDeliveryRequest<'a> {
    pub query_id: &'a str,
    pub handle: &'a str,
    pub path_price_krw: u64,
    pub owner_wallet: &'a str,
    pub quote_id: &'a str,
    pub payment_token_hash: Option<&'a str>,
    pub research_job_id: Option<&'a str>,
    pub policy: &'a PaymentQuotePolicy,
}

#[derive(Debug, Clone)]
pub struct PendingEmail {
    pub id: String,
    pub recipient: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletSiwxChallengeRecord {
    pub id: String,
    pub user_id: String,
    pub domain: String,
    pub uri: String,
    pub statement: String,
    pub nonce: String,
    pub issued_at: String,
    pub expiration_time: String,
    pub network: String,
    pub expires_at: u64,
    pub consumed_at: Option<u64>,
}

pub struct AiArtifactMetadata<'a> {
    pub model: &'a str,
    pub mode: &'a str,
    pub policy_version: &'a str,
    pub ttl_ms: u64,
}

#[derive(Clone)]
pub struct Store {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] db::Error),
    #[error("storage I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("store lock was poisoned")]
    LockPoisoned,
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("document was not quoted for this query")]
    DocumentNotQuoted,
}

#[derive(Debug)]
struct StoredCall {
    id: String,
    owner_id: String,
    question: String,
    unit_price: u64,
    target: usize,
    answered: usize,
    created_at: u64,
    chat_id: Option<String>,
    shelf: String,
    category: String,
    filters: SearchFilters,
    escrow_remaining_krw: u64,
    escrow_mode: String,
    escrow_wallet: Option<String>,
    escrow_asset: Option<String>,
    escrow_network: Option<String>,
    escrow_total_atomic: Option<u64>,
    escrow_remaining_atomic: Option<u64>,
    funding_transaction_signature: Option<String>,
    payer_wallet: Option<String>,
    status: String,
}

impl StoredCall {
    fn public(&self, user_id: Option<&str>, profile: Option<&UserProfile>) -> OpenCall {
        OpenCall {
            id: self.id.clone(),
            question: self.question.clone(),
            unit_price: self.unit_price,
            target: self.target,
            answered: self.answered,
            created_at: self.created_at,
            chat_id: self.chat_id.clone(),
            mine: user_id.is_some_and(|id| self.owner_id == id),
            shelf: self.shelf.clone(),
            category: self.category.clone(),
            filters: self.filters.clone(),
            eligible: profile.is_some_and(|profile| profile_matches(profile, &self.filters)),
            escrow_remaining_krw: self.escrow_remaining_krw,
            escrow_mode: self.escrow_mode.clone(),
            escrow_wallet: self.escrow_wallet.clone(),
            escrow_asset: self.escrow_asset.clone(),
            escrow_network: self.escrow_network.clone(),
            escrow_total_atomic: self.escrow_total_atomic.map(|amount| amount.to_string()),
            escrow_remaining_atomic: self
                .escrow_remaining_atomic
                .map(|amount| amount.to_string()),
            funding_transaction_signature: self.funding_transaction_signature.clone(),
            status: self.status.clone(),
            reserved_slots: 0,
            reservation_expires_at: None,
            recommendation_score: 0.0,
            recommendation_reason: Vec::new(),
        }
    }
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let database = path.to_string_lossy();
        let connection = if database.starts_with("postgres://")
            || database.starts_with("postgresql://")
            || database.starts_with("host=")
        {
            Connection::connect_postgres(&database)?
        } else {
            Connection::open(path)?
        };
        #[cfg(unix)]
        if connection.is_sqlite() && path != Path::new(":memory:") {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let production = production_environment();
        let seed_demo = env_flag("OPENSHELF_SEED_DEMO", !production);
        if production && seed_demo {
            return Err(StoreError::Validation(
                "OPENSHELF_SEED_DEMO cannot be enabled in production".to_owned(),
            ));
        }
        Self::from_connection(connection, seed_demo)
    }

    pub fn in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?, true)
    }

    fn from_connection(connection: Connection, seed_demo: bool) -> Result<Self, StoreError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        store.migrate()?;
        if seed_demo {
            store.seed()?;
        }
        Ok(store)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, StoreError> {
        self.connection.lock().map_err(|_| StoreError::LockPoisoned)
    }

    pub fn register_user(
        &self,
        email: &str,
        password_hash: &str,
    ) -> Result<UserAccount, StoreError> {
        let email = email.trim().to_lowercase();
        if !valid_email(&email) {
            return Err(StoreError::Validation(
                "enter a valid email address".to_owned(),
            ));
        }
        let id = new_id("user");
        let created_at = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO users
             (id, email, password_hash, role, created_at)
             VALUES (?1, ?2, ?3, 'user', ?4)",
            params![id, email, password_hash, as_i64(created_at)?],
        )?;
        if inserted == 0 {
            return Err(StoreError::Conflict(
                "an account with this email already exists".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO balances
             (user_id, available_krw, reserved_krw, held_krw, updated_at)
             VALUES (?1, ?2, 0, 0, ?3)",
            params![id, as_i64(SIGNUP_CREDIT_KRW)?, as_i64(created_at)?],
        )?;
        transaction.execute(
            "INSERT INTO funding_events
             (id, user_id, kind, amount_krw, created_at)
             VALUES (?1, ?2, 'sandbox_signup_credit', ?3, ?4)",
            params![
                new_id("fund"),
                id,
                as_i64(SIGNUP_CREDIT_KRW)?,
                as_i64(created_at)?
            ],
        )?;
        transaction.commit()?;
        Ok(UserAccount {
            id,
            email,
            role: "user".to_owned(),
            created_at,
        })
    }

    pub fn password_record(&self, email: &str) -> Result<(UserAccount, String), StoreError> {
        self.connection()?
            .query_row(
                "SELECT id, email, role, created_at, password_hash
                 FROM users WHERE email = ?1 COLLATE NOCASE AND deleted_at IS NULL",
                [email.trim()],
                |row| {
                    Ok((
                        UserAccount {
                            id: row.get(0)?,
                            email: row.get(1)?,
                            role: row.get(2)?,
                            created_at: as_u64(row.get(3)?)?,
                        },
                        row.get(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::Unauthorized("invalid email or password".to_owned()))
    }

    pub fn queue_password_reset(
        &self,
        email: &str,
        token_hash: &str,
        raw_token: &str,
        frontend_origin: &str,
    ) -> Result<(), StoreError> {
        let email = email.trim().to_lowercase();
        if email.len() > 320 || token_hash.len() != 64 || raw_token.len() < 32 {
            return Ok(());
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let user_id = transaction
            .query_row(
                "SELECT id FROM users WHERE email = ?1 COLLATE NOCASE AND deleted_at IS NULL",
                [&email],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(user_id) = user_id else {
            // Enumeration-safe: callers return the same status for unknown addresses.
            return Ok(());
        };
        let now = now_ms();
        transaction.execute(
            "DELETE FROM password_reset_tokens
             WHERE user_id = ?1 OR expires_at <= ?2 OR used_at IS NOT NULL",
            params![user_id, as_i64(now)?],
        )?;
        transaction.execute(
            "INSERT INTO password_reset_tokens
             (id, user_id, token_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                new_id("password-reset"),
                user_id,
                token_hash,
                as_i64(now.saturating_add(60 * 60 * 1_000))?,
                as_i64(now)?,
            ],
        )?;
        let reset_url = format!(
            "{}/login?mode=reset&token={}",
            frontend_origin.trim_end_matches('/'),
            raw_token
        );
        let notification_id = new_id("notification");
        transaction.execute(
            "INSERT INTO contributor_notifications
             (id, user_id, kind, title, body, open_call_id, created_at)
             VALUES (?1, ?2, 'password_reset_requested', 'Password reset requested',
                     'A one-hour password reset link was sent to your account email.', NULL, ?3)",
            params![notification_id, user_id, as_i64(now)?],
        )?;
        transaction.execute(
            "INSERT INTO email_outbox
             (id, notification_id, recipient, subject, body, status, attempts, created_at)
             VALUES (?1, ?2, ?3, 'Reset your OPENSHELF password', ?4, 'pending', 0, ?5)",
            params![
                new_id("email"),
                notification_id,
                email,
                format!(
                    "Use this link within one hour to reset your password:\n\n{reset_url}\n\nIf you did not request this, ignore this email."
                ),
                as_i64(now)?,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn reset_password(&self, token_hash: &str, password_hash: &str) -> Result<(), StoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let user_id = transaction
            .query_row(
                "SELECT user_id FROM password_reset_tokens
                 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2",
                params![token_hash, as_i64(now)?],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::Unauthorized("password reset link is invalid or expired".to_owned())
            })?;
        transaction.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![password_hash, user_id],
        )?;
        transaction.execute(
            "UPDATE password_reset_tokens SET used_at = ?1 WHERE token_hash = ?2",
            params![as_i64(now)?, token_hash],
        )?;
        transaction.execute("DELETE FROM sessions WHERE user_id = ?1", [&user_id])?;
        transaction.execute(
            "UPDATE prepaid_wallet_sessions SET revoked_at = ?1
             WHERE user_id = ?2 AND revoked_at IS NULL",
            params![as_i64(now)?, user_id],
        )?;
        transaction.execute(
            "DELETE FROM auth_failures WHERE email =
             (SELECT email FROM users WHERE id = ?1)",
            [&user_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn check_login_allowed(&self, email: &str) -> Result<(), StoreError> {
        let email = email.trim().to_lowercase();
        let now = now_ms();
        let blocked_until = self
            .connection()?
            .query_row(
                "SELECT blocked_until FROM auth_failures WHERE email = ?1",
                [email],
                |row| as_u64(row.get(0)?),
            )
            .optional()?;
        if blocked_until.is_some_and(|blocked_until| blocked_until > now) {
            return Err(StoreError::Unauthorized(
                "too many sign-in attempts; try again later".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn record_login_failure(&self, email: &str) -> Result<(), StoreError> {
        let email = email.trim().to_lowercase();
        if email.len() > 320 {
            return Ok(());
        }
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM auth_failures WHERE blocked_until < ?1 AND window_started_at < ?2",
            params![
                as_i64(now)?,
                as_i64(now.saturating_sub(24 * 60 * 60 * 1_000))?
            ],
        )?;
        let existing = transaction
            .query_row(
                "SELECT failure_count, window_started_at FROM auth_failures WHERE email = ?1",
                [&email],
                |row| Ok((as_u64(row.get(0)?)?, as_u64(row.get(1)?)?)),
            )
            .optional()?;
        let (failure_count, window_started_at) = match existing {
            Some((count, started_at))
                if started_at.saturating_add(LOGIN_FAILURE_WINDOW_MS) > now =>
            {
                (count.saturating_add(1), started_at)
            }
            _ => (1, now),
        };
        let blocked_until = if failure_count >= LOGIN_FAILURE_LIMIT {
            now.saturating_add(LOGIN_BLOCK_MS)
        } else {
            0
        };
        transaction.execute(
            "INSERT INTO auth_failures
             (email, failure_count, window_started_at, blocked_until, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(email) DO UPDATE SET
               failure_count = excluded.failure_count,
               window_started_at = excluded.window_started_at,
               blocked_until = excluded.blocked_until,
               updated_at = excluded.updated_at",
            params![
                email,
                as_i64(failure_count)?,
                as_i64(window_started_at)?,
                as_i64(blocked_until)?,
                as_i64(now)?,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn clear_login_failures(&self, email: &str) -> Result<(), StoreError> {
        self.connection()?.execute(
            "DELETE FROM auth_failures WHERE email = ?1",
            [email.trim().to_lowercase()],
        )?;
        Ok(())
    }

    pub fn ready(&self) -> Result<(), StoreError> {
        self.connection()?
            .query_row("SELECT 1", params![], |_| Ok(()))?;
        Ok(())
    }

    pub fn contains_demo_seed_data(&self) -> Result<bool, StoreError> {
        Ok(self.connection()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE author_id LIKE 'author_%')",
            params![],
            |row| row.get::<_, bool>(0),
        )?)
    }

    pub fn create_session(
        &self,
        user_id: &str,
        token_hash: &str,
        expires_at: u64,
    ) -> Result<(), StoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            [as_i64(now)?],
        )?;
        transaction.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![token_hash, user_id, as_i64(expires_at)?, as_i64(now)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn authenticate_session(&self, token_hash: &str) -> Result<UserAccount, StoreError> {
        self.connection()?
            .query_row(
                "SELECT u.id, u.email, u.role, u.created_at
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.deleted_at IS NULL",
                params![token_hash, as_i64(now_ms())?],
                |row| {
                    Ok(UserAccount {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        role: row.get(2)?,
                        created_at: as_u64(row.get(3)?)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::Unauthorized("sign in to continue".to_owned()))
    }

    pub fn revoke_session(&self, token_hash: &str) -> Result<(), StoreError> {
        self.connection()?
            .execute("DELETE FROM sessions WHERE token_hash = ?1", [token_hash])?;
        Ok(())
    }

    pub fn revoke_prepaid_sessions(&self, user_id: &str) -> Result<(), StoreError> {
        self.connection()?.execute(
            "UPDATE prepaid_wallet_sessions SET revoked_at = ?1
             WHERE user_id = ?2 AND revoked_at IS NULL",
            params![as_i64(now_ms())?, user_id.trim()],
        )?;
        Ok(())
    }

    pub fn balance(&self, user_id: &str) -> Result<BalanceSummary, StoreError> {
        self.release_matured_holds(user_id)?;
        self.connection()?
            .query_row(
                "SELECT available_krw, reserved_krw, held_krw
                 FROM balances WHERE user_id = ?1",
                [user_id],
                |row| {
                    Ok(BalanceSummary {
                        currency: "KRW_SANDBOX",
                        available_krw: as_u64(row.get(0)?)?,
                        reserved_krw: as_u64(row.get(1)?)?,
                        held_krw: as_u64(row.get(2)?)?,
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("balance"))
    }

    fn release_matured_holds(&self, user_id: &str) -> Result<(), StoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let matured = transaction.query_row(
            "SELECT COALESCE(CAST(SUM(amount_krw) AS BIGINT), 0) FROM earning_events
             WHERE author_id = ?1 AND payout_status = 'held' AND available_at <= ?2",
            params![user_id, as_i64(now)?],
            |row| as_u64(row.get(0)?),
        )?;
        if matured > 0 {
            transaction.execute(
                "UPDATE earning_events SET payout_status = 'accrued'
                 WHERE author_id = ?1 AND payout_status = 'held' AND available_at <= ?2",
                params![user_id, as_i64(now)?],
            )?;
            transaction.execute(
                "UPDATE balances SET held_krw = held_krw - ?1,
                    available_krw = available_krw + ?1, updated_at = ?2
                 WHERE user_id = ?3 AND held_krw >= ?1",
                params![as_i64(matured)?, as_i64(now)?, user_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn set_user_role(&self, user_id: &str, role: &str) -> Result<(), StoreError> {
        if !["user", "admin"].contains(&role) {
            return Err(StoreError::Validation("unsupported role".to_owned()));
        }
        let changed = self.connection()?.execute(
            "UPDATE users SET role = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![role, user_id],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound("user"));
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn provision_user_for_test(&self, user_id: &str) -> Result<(), StoreError> {
        let now = now_ms();
        let connection = self.connection()?;
        connection.execute(
            "INSERT OR IGNORE INTO users (id, email, password_hash, role, created_at)
             VALUES (?1, ?2, 'test-only-hash', 'user', ?3)",
            params![user_id, format!("{user_id}@test.invalid"), as_i64(now)?],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO balances
             (user_id, available_krw, reserved_krw, held_krw, updated_at)
             VALUES (?1, ?2, 0, 0, ?3)",
            params![user_id, as_i64(SIGNUP_CREDIT_KRW)?, as_i64(now)?],
        )?;
        Ok(())
    }

    fn migrate(&self) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                handle TEXT NOT NULL UNIQUE,
                author_id TEXT NOT NULL,
                shelf_id TEXT NOT NULL,
                shelf TEXT NOT NULL,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                price_krw INTEGER NOT NULL CHECK (price_krw >= 0),
                created_at INTEGER NOT NULL,
                quality_score REAL NOT NULL,
                reliability_score REAL NOT NULL,
                locked INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS queries (
                id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                decision TEXT NOT NULL,
                liquidity_state TEXT NOT NULL DEFAULT 'human_covered',
                payment_token_hash TEXT,
                payment_token_expires_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_baselines (
                id TEXT PRIMARY KEY,
                query_id TEXT NOT NULL UNIQUE REFERENCES queries(id) ON DELETE CASCADE,
                orientation TEXT NOT NULL,
                general_points_json TEXT NOT NULL,
                human_gaps_json TEXT NOT NULL,
                questions_for_people_json TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                policy_version TEXT NOT NULL,
                generated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shelf_starters (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                prompt TEXT NOT NULL,
                rationale TEXT NOT NULL,
                category TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                policy_version TEXT NOT NULL,
                generated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                answered_at INTEGER,
                document_id TEXT REFERENCES documents(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS evidence_edges (
                id TEXT PRIMARY KEY,
                source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                target_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                relation TEXT NOT NULL,
                provenance TEXT NOT NULL,
                topic TEXT NOT NULL,
                weight REAL NOT NULL,
                actor TEXT NOT NULL DEFAULT 'legacy',
                created_at INTEGER NOT NULL,
                UNIQUE(source_document_id, target_document_id, relation, provenance, topic)
            );

            CREATE TABLE IF NOT EXISTS query_matches (
                query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
                document_handle TEXT NOT NULL REFERENCES documents(handle),
                rank INTEGER NOT NULL,
                quoted_price_krw INTEGER NOT NULL,
                PRIMARY KEY (query_id, document_handle)
            );

            CREATE TABLE IF NOT EXISTS open_calls (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                question TEXT NOT NULL,
                unit_price_krw INTEGER NOT NULL CHECK (unit_price_krw >= 0),
                target INTEGER NOT NULL CHECK (target > 0),
                answered INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                chat_id TEXT,
                shelf TEXT NOT NULL,
                category TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                escrow_remaining_krw INTEGER NOT NULL DEFAULT 0,
                target_age_band TEXT,
                target_region TEXT,
                target_household TEXT,
                target_field TEXT,
                escrow_mode TEXT NOT NULL DEFAULT 'sandbox',
                escrow_wallet TEXT,
                escrow_asset TEXT,
                escrow_network TEXT,
                escrow_total_atomic INTEGER,
                escrow_remaining_atomic INTEGER,
                funding_transaction_signature TEXT,
                payer_wallet TEXT
            );

            CREATE TABLE IF NOT EXISTS open_call_funding_quotes (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                request_json TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                network TEXT NOT NULL,
                asset TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                total_price_krw INTEGER NOT NULL CHECK (total_price_krw > 0),
                krw_per_usdc INTEGER NOT NULL CHECK (krw_per_usdc > 0),
                expires_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'quoted',
                open_call_id TEXT UNIQUE REFERENCES open_calls(id) ON DELETE SET NULL,
                payer_wallet TEXT,
                settled_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS open_call_chain_settlements (
                id TEXT PRIMARY KEY,
                quote_id TEXT NOT NULL UNIQUE REFERENCES open_call_funding_quotes(id),
                open_call_id TEXT NOT NULL UNIQUE REFERENCES open_calls(id),
                transaction_signature TEXT NOT NULL UNIQUE,
                payer TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                network TEXT NOT NULL,
                raw_response_json TEXT NOT NULL,
                confirmed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memory_entries (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                open_call_id TEXT REFERENCES open_calls(id),
                document_id TEXT REFERENCES documents(id),
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                shelf TEXT NOT NULL,
                earned_krw INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                via TEXT NOT NULL,
                status TEXT NOT NULL,
                flags_json TEXT NOT NULL DEFAULT '[]',
                rating INTEGER,
                interview_json TEXT NOT NULL DEFAULT '[]',
                memory_type TEXT NOT NULL DEFAULT 'observation',
                importance REAL NOT NULL DEFAULT 0.7,
                reliability_score REAL NOT NULL DEFAULT 0.5,
                content_hash TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1,
                locked INTEGER NOT NULL DEFAULT 0,
                access_count INTEGER NOT NULL DEFAULT 0,
                last_accessed_at INTEGER,
                source_ids_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS settlements (
                id TEXT PRIMARY KEY,
                query_id TEXT NOT NULL REFERENCES queries(id),
                payer TEXT,
                document_handles_json TEXT NOT NULL,
                total_krw INTEGER NOT NULL,
                mode TEXT NOT NULL,
                transaction_signature TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payment_quotes (
                id TEXT PRIMARY KEY,
                query_id TEXT NOT NULL,
                document_id TEXT NOT NULL,
                document_handle TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                network TEXT NOT NULL,
                asset TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                price_krw INTEGER NOT NULL CHECK (price_krw >= 0),
                krw_per_usdc INTEGER NOT NULL CHECK (krw_per_usdc > 0),
                expires_at INTEGER NOT NULL,
                settled_at INTEGER,
                created_at INTEGER NOT NULL,
                content_snapshot TEXT NOT NULL DEFAULT '',
                shelf_snapshot TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',
                document_version INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'quoted',
                consent_version TEXT NOT NULL DEFAULT 'legacy',
                delivered_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS memory_access_events (
                id TEXT PRIMARY KEY,
                memory_id TEXT REFERENCES memory_entries(id) ON DELETE SET NULL,
                document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
                quote_id TEXT REFERENCES payment_quotes(id) ON DELETE SET NULL,
                actor TEXT NOT NULL,
                purpose TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evidence_contributions (
                query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                score REAL NOT NULL,
                reason TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY(query_id, document_id)
            );

            CREATE TABLE IF NOT EXISTS chain_settlements (
                id TEXT PRIMARY KEY,
                quote_id TEXT NOT NULL UNIQUE REFERENCES payment_quotes(id),
                settlement_id TEXT NOT NULL UNIQUE REFERENCES settlements(id),
                transaction_signature TEXT NOT NULL UNIQUE,
                payer TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                network TEXT NOT NULL,
                raw_response_json TEXT NOT NULL,
                confirmed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payment_bundle_quotes (
                id TEXT PRIMARY KEY,
                query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
                pay_to TEXT NOT NULL,
                network TEXT NOT NULL,
                asset TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                total_price_krw INTEGER NOT NULL CHECK (total_price_krw >= 0),
                krw_per_usdc INTEGER NOT NULL CHECK (krw_per_usdc > 0),
                expires_at INTEGER NOT NULL,
                settled_at INTEGER,
                delivered_at INTEGER,
                created_at INTEGER NOT NULL,
                bundle_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'quoted',
                payer_wallet TEXT,
                failure_reason TEXT,
                refund_claim_id TEXT
            );

            CREATE TABLE IF NOT EXISTS prepaid_wallet_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                wallet TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prepaid_accounts (
                wallet TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                network TEXT NOT NULL,
                asset TEXT NOT NULL,
                available_atomic INTEGER NOT NULL DEFAULT 0 CHECK (available_atomic >= 0),
                total_deposited_atomic INTEGER NOT NULL DEFAULT 0 CHECK (total_deposited_atomic >= 0),
                updated_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (wallet, pay_to, network, asset)
            );

            CREATE TABLE IF NOT EXISTS prepaid_ledger (
                id TEXT PRIMARY KEY,
                wallet TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                network TEXT NOT NULL,
                asset TEXT NOT NULL,
                kind TEXT NOT NULL,
                reference_id TEXT NOT NULL,
                delta_atomic INTEGER NOT NULL,
                balance_after_atomic INTEGER NOT NULL CHECK (balance_after_atomic >= 0),
                created_at INTEGER NOT NULL,
                UNIQUE (kind, reference_id)
            );

            CREATE TABLE IF NOT EXISTS payment_bundle_documents (
                quote_id TEXT NOT NULL REFERENCES payment_bundle_quotes(id) ON DELETE CASCADE,
                rank INTEGER NOT NULL,
                document_id TEXT NOT NULL REFERENCES documents(id),
                document_handle TEXT NOT NULL,
                author_id TEXT NOT NULL,
                recipient_wallet TEXT NOT NULL,
                price_krw INTEGER NOT NULL CHECK (price_krw >= 0),
                shelf_snapshot TEXT NOT NULL,
                content_snapshot TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                document_version INTEGER NOT NULL,
                consent_version TEXT NOT NULL,
                pay_sh_quote_id TEXT REFERENCES payment_quotes(id) ON DELETE SET NULL,
                PRIMARY KEY (quote_id, document_id),
                UNIQUE (quote_id, document_handle)
            );

            CREATE TABLE IF NOT EXISTS bundle_chain_settlements (
                id TEXT PRIMARY KEY,
                quote_id TEXT NOT NULL UNIQUE REFERENCES payment_bundle_quotes(id),
                settlement_id TEXT NOT NULL UNIQUE REFERENCES settlements(id),
                transaction_signature TEXT NOT NULL UNIQUE,
                payer TEXT NOT NULL,
                pay_to TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                network TEXT NOT NULL,
                raw_response_json TEXT NOT NULL,
                confirmed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dispute_events (
                user_id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL REFERENCES memory_entries(id),
                reason TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                reviewer_id TEXT,
                review_note TEXT,
                reviewed_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at INTEGER NOT NULL,
                deleted_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_failures (
                email TEXT PRIMARY KEY COLLATE NOCASE,
                failure_count INTEGER NOT NULL,
                window_started_at INTEGER NOT NULL,
                blocked_until INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS balances (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                available_krw INTEGER NOT NULL CHECK (available_krw >= 0),
                reserved_krw INTEGER NOT NULL CHECK (reserved_krw >= 0),
                held_krw INTEGER NOT NULL CHECK (held_krw >= 0),
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS funding_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                open_call_id TEXT,
                kind TEXT NOT NULL,
                amount_krw INTEGER NOT NULL CHECK (amount_krw >= 0),
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS profiles (
                user_id TEXT PRIMARY KEY,
                handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
                age_band TEXT NOT NULL,
                region TEXT NOT NULL,
                household TEXT NOT NULL,
                field TEXT NOT NULL,
                years TEXT NOT NULL,
                speaks_to_json TEXT NOT NULL,
                wallet TEXT,
                wallet_verified_at INTEGER,
                agreed_at INTEGER NOT NULL,
                consent_version TEXT NOT NULL DEFAULT 'legacy',
                auto_match INTEGER NOT NULL DEFAULT 1,
                agents INTEGER NOT NULL DEFAULT 0,
                browser_alerts INTEGER NOT NULL DEFAULT 0,
                email_alerts INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS open_call_reservations (
                id TEXT PRIMARY KEY,
                open_call_id TEXT NOT NULL REFERENCES open_calls(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(open_call_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS contributor_notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                open_call_id TEXT REFERENCES open_calls(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                UNIQUE(user_id, kind, open_call_id)
            );

            CREATE TABLE IF NOT EXISTS email_outbox (
                id TEXT PRIMARY KEY,
                notification_id TEXT NOT NULL UNIQUE REFERENCES contributor_notifications(id) ON DELETE CASCADE,
                recipient TEXT NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                delivered_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS earning_events (
                id TEXT PRIMARY KEY,
                settlement_id TEXT REFERENCES settlements(id),
                memory_id TEXT REFERENCES memory_entries(id),
                document_id TEXT REFERENCES documents(id),
                author_id TEXT NOT NULL,
                source TEXT NOT NULL,
                amount_krw INTEGER NOT NULL CHECK (amount_krw >= 0),
                recipient_wallet TEXT,
                payout_status TEXT NOT NULL,
                available_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payout_claims (
                id TEXT PRIMARY KEY,
                earning_event_id TEXT UNIQUE REFERENCES earning_events(id) ON DELETE SET NULL,
                open_call_id TEXT REFERENCES open_calls(id) ON DELETE SET NULL,
                beneficiary_user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                escrow_wallet TEXT NOT NULL,
                recipient_wallet TEXT NOT NULL,
                asset TEXT NOT NULL,
                network TEXT NOT NULL,
                amount_atomic INTEGER NOT NULL CHECK (amount_atomic > 0),
                amount_krw INTEGER NOT NULL CHECK (amount_krw >= 0),
                status TEXT NOT NULL DEFAULT 'pending',
                lease_owner TEXT,
                lease_expires_at INTEGER,
                transaction_signature TEXT UNIQUE,
                signed_transaction_base64 TEXT,
                recent_blockhash TEXT,
                last_valid_block_height INTEGER,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                confirmed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS wallet_challenges (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                wallet TEXT NOT NULL,
                message TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS wallet_siwx_challenges (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                domain TEXT NOT NULL,
                uri TEXT NOT NULL,
                statement TEXT NOT NULL,
                nonce TEXT NOT NULL,
                issued_at TEXT NOT NULL,
                expiration_time TEXT NOT NULL,
                network TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_feedback (
                id TEXT PRIMARY KEY,
                query_id TEXT NOT NULL,
                document_id TEXT NOT NULL,
                document_handle TEXT NOT NULL,
                settlement_id TEXT NOT NULL UNIQUE,
                payer TEXT NOT NULL,
                outcome TEXT NOT NULL,
                reason TEXT,
                status TEXT NOT NULL,
                reviewer_id TEXT,
                review_note TEXT,
                reviewed_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_active
                ON documents(locked, category);
            CREATE INDEX IF NOT EXISTS idx_evidence_edges_source
                ON evidence_edges(source_document_id);
            CREATE INDEX IF NOT EXISTS idx_evidence_edges_target
                ON evidence_edges(target_document_id, topic);
            CREATE INDEX IF NOT EXISTS idx_open_calls_created
                ON open_calls(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_open_call_funding_quotes_owner
                ON open_call_funding_quotes(owner_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_user
                ON memory_entries(user_id, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_one_answer_per_call
                ON memory_entries(open_call_id, user_id)
                WHERE open_call_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_earnings_author
                ON earning_events(author_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payout_claims_work
                ON payout_claims(status, lease_expires_at, created_at);
            CREATE INDEX IF NOT EXISTS idx_payout_claims_beneficiary
                ON payout_claims(beneficiary_user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_user
                ON sessions(user_id, expires_at);
            CREATE INDEX IF NOT EXISTS idx_funding_user
                ON funding_events(user_id, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_settlement_document
                ON earning_events(settlement_id, document_id)
                WHERE settlement_id IS NOT NULL AND document_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_payment_quotes_lookup
                ON payment_quotes(query_id, document_handle, expires_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chain_settlements_signature
                ON chain_settlements(transaction_signature);
            CREATE INDEX IF NOT EXISTS idx_payment_bundle_quotes_lookup
                ON payment_bundle_quotes(query_id, expires_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payment_bundle_documents_handle
                ON payment_bundle_documents(document_handle, quote_id);
            CREATE INDEX IF NOT EXISTS idx_bundle_chain_settlements_signature
                ON bundle_chain_settlements(transaction_signature);
            CREATE INDEX IF NOT EXISTS idx_wallet_challenges_user
                ON wallet_challenges(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_wallet_siwx_challenges_user
                ON wallet_siwx_challenges(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_document_feedback_status
                ON document_feedback(status, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_memory_access_memory
                ON memory_access_events(memory_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_open_call_reservations_active
                ON open_call_reservations(open_call_id, expires_at);
            CREATE INDEX IF NOT EXISTS idx_contributor_notifications_user
                ON contributor_notifications(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
                ON email_outbox(status, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry
                ON password_reset_tokens(expires_at, used_at);
            CREATE INDEX IF NOT EXISTS idx_ai_baselines_expiry
                ON ai_baselines(expires_at);
            CREATE INDEX IF NOT EXISTS idx_shelf_starters_user
                ON shelf_starters(user_id, answered_at, expires_at DESC);
            "#,
        )?;
        add_column_if_missing(&connection, "queries", "payment_token_hash", "TEXT")?;
        add_column_if_missing(
            &connection,
            "queries",
            "payment_token_expires_at",
            "INTEGER",
        )?;
        connection.execute(
            "UPDATE queries SET payment_token_expires_at = created_at + ?1
             WHERE payment_token_hash IS NOT NULL AND payment_token_expires_at IS NULL",
            [as_i64(QUERY_TOKEN_TTL_MS)?],
        )?;
        add_column_if_missing(
            &connection,
            "queries",
            "liquidity_state",
            "TEXT NOT NULL DEFAULT 'human_covered'",
        )?;
        add_column_if_missing(
            &connection,
            "memory_entries",
            "interview_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        for (name, definition) in [
            ("memory_type", "TEXT NOT NULL DEFAULT 'observation'"),
            ("importance", "REAL NOT NULL DEFAULT 0.7"),
            ("reliability_score", "REAL NOT NULL DEFAULT 0.5"),
            ("content_hash", "TEXT NOT NULL DEFAULT ''"),
            ("version", "INTEGER NOT NULL DEFAULT 1"),
            ("locked", "INTEGER NOT NULL DEFAULT 0"),
            ("access_count", "INTEGER NOT NULL DEFAULT 0"),
            ("last_accessed_at", "INTEGER"),
            ("source_ids_json", "TEXT NOT NULL DEFAULT '[]'"),
        ] {
            add_column_if_missing(&connection, "memory_entries", name, definition)?;
        }
        for (name, definition) in [
            ("content_hash", "TEXT NOT NULL DEFAULT ''"),
            ("version", "INTEGER NOT NULL DEFAULT 1"),
        ] {
            add_column_if_missing(&connection, "documents", name, definition)?;
        }
        for (name, definition) in [
            ("content_snapshot", "TEXT NOT NULL DEFAULT ''"),
            ("shelf_snapshot", "TEXT NOT NULL DEFAULT ''"),
            ("content_hash", "TEXT NOT NULL DEFAULT ''"),
            ("document_version", "INTEGER NOT NULL DEFAULT 1"),
            ("status", "TEXT NOT NULL DEFAULT 'quoted'"),
            ("consent_version", "TEXT NOT NULL DEFAULT 'legacy'"),
            ("delivered_at", "INTEGER"),
        ] {
            add_column_if_missing(&connection, "payment_quotes", name, definition)?;
        }
        for (name, definition) in [
            ("payer_wallet", "TEXT"),
            ("failure_reason", "TEXT"),
            ("refund_claim_id", "TEXT"),
            ("deposit_atomic", "INTEGER NOT NULL DEFAULT 0"),
            ("funding_source", "TEXT NOT NULL DEFAULT 'legacy_direct'"),
            ("balance_release_atomic", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            add_column_if_missing(&connection, "payment_bundle_quotes", name, definition)?;
        }
        connection.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_prepaid_sessions_wallet
                 ON prepaid_wallet_sessions(wallet, expires_at DESC);
             CREATE INDEX IF NOT EXISTS idx_prepaid_ledger_wallet
                 ON prepaid_ledger(wallet, created_at DESC);",
        )?;
        add_column_if_missing(
            &connection,
            "payment_bundle_documents",
            "pay_sh_quote_id",
            "TEXT REFERENCES payment_quotes(id) ON DELETE SET NULL",
        )?;
        add_column_if_missing(
            &connection,
            "evidence_edges",
            "actor",
            "TEXT NOT NULL DEFAULT 'legacy'",
        )?;
        add_column_if_missing(&connection, "profiles", "wallet_verified_at", "INTEGER")?;
        add_column_if_missing(
            &connection,
            "profiles",
            "browser_alerts",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &connection,
            "profiles",
            "email_alerts",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &connection,
            "profiles",
            "consent_version",
            "TEXT NOT NULL DEFAULT 'legacy'",
        )?;
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_wallet_owner
             ON profiles(wallet)
             WHERE wallet IS NOT NULL AND wallet_verified_at IS NOT NULL",
            params![],
        )?;
        add_column_if_missing(
            &connection,
            "earning_events",
            "available_at",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &connection,
            "open_calls",
            "escrow_remaining_krw",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        for (name, definition) in [
            ("target_age_band", "TEXT"),
            ("target_region", "TEXT"),
            ("target_household", "TEXT"),
            ("target_field", "TEXT"),
        ] {
            add_column_if_missing(&connection, "open_calls", name, definition)?;
        }
        for (name, definition) in [
            ("escrow_mode", "TEXT NOT NULL DEFAULT 'sandbox'"),
            ("escrow_wallet", "TEXT"),
            ("escrow_asset", "TEXT"),
            ("escrow_network", "TEXT"),
            ("escrow_total_atomic", "INTEGER"),
            ("escrow_remaining_atomic", "INTEGER"),
            ("funding_transaction_signature", "TEXT"),
            ("payer_wallet", "TEXT"),
        ] {
            add_column_if_missing(&connection, "open_calls", name, definition)?;
        }
        for (name, definition) in [
            ("reason", "TEXT NOT NULL DEFAULT ''"),
            ("status", "TEXT NOT NULL DEFAULT 'pending'"),
            ("reviewer_id", "TEXT"),
            ("review_note", "TEXT"),
            ("reviewed_at", "INTEGER"),
        ] {
            add_column_if_missing(&connection, "dispute_events", name, definition)?;
        }
        connection.execute(
            "UPDATE earning_events SET available_at = created_at WHERE available_at = 0",
            params![],
        )?;
        connection.execute(
            "UPDATE open_calls
             SET escrow_remaining_krw = unit_price_krw * (target - answered)
             WHERE escrow_remaining_krw = 0 AND status = 'open' AND unit_price_krw > 0",
            params![],
        )?;
        connection.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0
             WHERE owner_id <> 'seed-buyer'
               AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id = open_calls.owner_id)",
            params![],
        )?;
        connection.execute(
            "UPDATE dispute_events SET status = 'approved' WHERE status = 'pending' AND reason = ''",
            params![],
        )?;
        backfill_bundle_payout_claims(&connection)?;
        backfill_content_hashes(&connection)?;
        Ok(())
    }

    fn seed(&self) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        for document in seed::documents() {
            insert_document(
                &transaction,
                &document,
                now_ms().saturating_sub(document.age_days as u64 * 86_400_000),
            )?;
            // Demo data is versioned with the application. INSERT OR IGNORE keeps
            // user-authored rows safe, while this narrow update lets corrected
            // seed pricing reach an existing development database on restart.
            transaction.execute(
                "UPDATE documents SET price_krw = ?1
                 WHERE id = ?2 AND handle = ?3 AND author_id = ?4",
                params![
                    as_i64(document.price_krw)?,
                    document.id,
                    document.handle,
                    document.author_id,
                ],
            )?;
        }
        seed_evidence_edges(&transaction)?;
        seed_open_calls(&transaction)?;
        seed_memory(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn documents(&self) -> Result<Vec<Document>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT d.id, d.handle, d.author_id, d.shelf_id, d.shelf, d.category,
                    d.content, d.tags_json, d.price_krw, d.created_at, d.quality_score,
                    d.reliability_score, d.locked,
                    p.age_band, p.region, p.household, p.field
             FROM documents d
             LEFT JOIN profiles p ON p.user_id = d.author_id
             WHERE d.locked = 0
               AND COALESCE(p.auto_match, 1) = 1
               AND (SELECT COUNT(*) FROM memory_entries m
                    WHERE m.user_id = d.author_id AND m.status = 'voided') < ?1",
        )?;
        let documents = statement
            .query_map([AUTO_MATCH_STRIKE_LIMIT as i64], document_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(documents)
    }

    pub fn evidence_edges(&self) -> Result<Vec<EvidenceEdge>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT e.source_document_id, e.target_document_id, e.relation,
                    e.provenance, e.topic, e.weight
             FROM evidence_edges e
             JOIN documents source ON source.id = e.source_document_id
             JOIN documents target ON target.id = e.target_document_id
             WHERE source.locked = 0 AND target.locked = 0
               AND source.author_id <> target.author_id",
        )?;
        Ok(statement
            .query_map(params![], |row| {
                Ok(EvidenceEdge {
                    source_document_id: row.get(0)?,
                    target_document_id: row.get(1)?,
                    relation: row.get(2)?,
                    provenance: row.get(3)?,
                    topic: row.get(4)?,
                    weight: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn opened_evidence(
        &self,
        query_id: &str,
        handles: &[String],
        payment_token_hash: &str,
    ) -> Result<(String, Vec<Citation>), StoreError> {
        if query_id.trim().is_empty() || handles.is_empty() || handles.len() > 20 {
            return Err(StoreError::Validation(
                "a query id and between 1 and 20 handles are required".to_owned(),
            ));
        }
        if handles.iter().any(|handle| handle.trim().is_empty())
            || handles.iter().collect::<HashSet<_>>().len() != handles.len()
        {
            return Err(StoreError::Validation(
                "document handles must be non-empty and unique".to_owned(),
            ));
        }
        let connection = self.connection()?;
        require_query_access(&connection, query_id.trim(), payment_token_hash)?;
        let question = connection
            .query_row(
                "SELECT question FROM queries WHERE id = ?1",
                [query_id.trim()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("query"))?;
        let opened = {
            let mut statement = connection.prepare(
                "SELECT document_handles_json FROM settlements
                     WHERE query_id = ?1 AND mode <> 'x402_solana_bundle_escrow'",
            )?;
            let mut handles = statement
                .query_map([query_id.trim()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .flat_map(|json| serde_json::from_str::<Vec<String>>(json).unwrap_or_default())
                .collect::<HashSet<_>>();
            let mut legacy_statement = connection.prepare(
                "SELECT pbd.document_handle
                 FROM payment_bundle_documents pbd
                 JOIN payment_bundle_quotes pbq ON pbq.id = pbd.quote_id
                 WHERE pbq.query_id = ?1 AND pbq.status IN ('delivered', 'completed')
                   AND (pbq.status = 'delivered' OR EXISTS (
                     SELECT 1 FROM payment_quotes paid
                     WHERE paid.id = pbd.pay_sh_quote_id AND paid.status = 'delivered'
                   ))",
            )?;
            handles.extend(
                legacy_statement
                    .query_map([query_id.trim()], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?,
            );
            handles
        };
        if !handles.iter().all(|handle| opened.contains(handle)) {
            return Err(StoreError::DocumentNotQuoted);
        }

        let mut citations = Vec::with_capacity(handles.len());
        for handle in handles {
            let settled_snapshot = connection
                .query_row(
                    "SELECT document_handle, shelf_snapshot, content_snapshot, price_krw
                     FROM payment_quotes
                     WHERE query_id = ?1 AND document_handle = ?2 AND settled_at IS NOT NULL
                     ORDER BY settled_at DESC LIMIT 1",
                    params![query_id.trim(), handle],
                    |row| {
                        Ok(Citation {
                            handle: row.get(0)?,
                            shelf: row.get(1)?,
                            excerpt: row.get(2)?,
                            price: as_u64(row.get(3)?)?,
                        })
                    },
                )
                .optional()?;
            let citation = if let Some(snapshot) = settled_snapshot {
                snapshot
            } else {
                connection
                    .query_row(
                        "SELECT d.handle, d.shelf, d.content, qm.quoted_price_krw
                         FROM query_matches qm
                         JOIN documents d ON d.handle = qm.document_handle
                         LEFT JOIN profiles p ON p.user_id = d.author_id
                         WHERE qm.query_id = ?1 AND qm.document_handle = ?2
                           AND d.locked = 0 AND COALESCE(p.auto_match, 1) = 1
                           AND (SELECT COUNT(*) FROM memory_entries strikes
                                WHERE strikes.user_id = d.author_id
                                  AND strikes.status = 'voided') < ?3",
                        params![query_id.trim(), handle, AUTO_MATCH_STRIKE_LIMIT as i64],
                        |row| {
                            Ok(Citation {
                                handle: row.get(0)?,
                                shelf: row.get(1)?,
                                excerpt: row.get(2)?,
                                price: as_u64(row.get(3)?)?,
                            })
                        },
                    )
                    .optional()?
                    .ok_or(StoreError::DocumentNotQuoted)?
            };
            citations.push(citation);
        }
        Ok((question, citations))
    }

    pub fn record_contributions(
        &self,
        query_id: &str,
        contributions: &[EvidenceContribution],
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        for contribution in contributions {
            if !contribution.score.is_finite()
                || !(0.0..=1.0).contains(&contribution.score)
                || contribution.reason.chars().count() > 500
            {
                return Err(StoreError::Validation(
                    "invalid evidence contribution".to_owned(),
                ));
            }
            let matched = transaction
                .query_row(
                    "SELECT pq.document_id, d.reliability_score
                     FROM payment_quotes pq
                     JOIN documents d ON d.id = pq.document_id
                     WHERE pq.query_id = ?1 AND pq.document_handle = ?2
                       AND pq.settled_at IS NOT NULL
                     ORDER BY pq.settled_at DESC LIMIT 1",
                    params![query_id.trim(), contribution.handle.trim()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?)),
                )
                .optional()?;
            let Some((document_id, current_reliability)) = matched else {
                continue;
            };
            let inserted = transaction.execute(
                "INSERT OR IGNORE INTO evidence_contributions
                 (query_id, document_id, score, reason, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    query_id.trim(),
                    document_id,
                    contribution.score,
                    contribution.reason.trim(),
                    as_i64(now_ms())?,
                ],
            )?;
            // A synthesis retry must not repeatedly compound one model score
            // into the contributor's reputation.
            if inserted == 0 {
                continue;
            }
            let reliability =
                (current_reliability * 0.9 + contribution.score * 0.1).clamp(0.05, 0.98);
            transaction.execute(
                "UPDATE documents SET reliability_score = ?1 WHERE id = ?2",
                params![reliability, document_id],
            )?;
            transaction.execute(
                "UPDATE memory_entries SET reliability_score = ?1 WHERE document_id = ?2",
                params![reliability, document_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn record_resolution(
        &self,
        question: &str,
        response: &ResolveQuestionResponse,
        payment_token_hash: Option<&str>,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let created_at = now_ms();
        transaction.execute(
            "INSERT INTO queries
             (id, question, decision, liquidity_state, payment_token_hash,
              payment_token_expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                response.query_id,
                question,
                format!("{:?}", response.decision).to_lowercase(),
                liquidity_state_name(response.liquidity_state),
                payment_token_hash,
                payment_token_hash
                    .map(|_| as_i64(created_at.saturating_add(QUERY_TOKEN_TTL_MS)))
                    .transpose()?,
                as_i64(created_at)?
            ],
        )?;
        for (rank, matched) in response.matches.iter().enumerate() {
            transaction.execute(
                "INSERT INTO query_matches (query_id, document_handle, rank, quoted_price_krw)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    response.query_id,
                    matched.handle,
                    rank as i64,
                    as_i64(matched.price_krw)?
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Returns the server-owned question and a still-live cached baseline.
    /// Human-covered queries are rejected before any model call can happen.
    pub fn ai_baseline_context(
        &self,
        query_id: &str,
        payment_token_hash: &str,
    ) -> Result<(String, Option<AiBaseline>), StoreError> {
        let query_id = query_id.trim();
        let connection = self.connection()?;
        require_query_access(&connection, query_id, payment_token_hash)?;
        let (question, liquidity_state) = connection
            .query_row(
                "SELECT question, liquidity_state FROM queries WHERE id = ?1",
                [query_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("query"))?;
        if liquidity_state == "human_covered" {
            return Err(StoreError::Conflict(
                "human coverage is sufficient; AI liquidity is disabled".to_owned(),
            ));
        }
        let baseline = load_ai_baseline(&connection, query_id, now_ms())?;
        Ok((question, baseline))
    }

    pub fn record_ai_baseline(
        &self,
        query_id: &str,
        payment_token_hash: &str,
        draft: &AiBaselineDraft,
        metadata: &AiArtifactMetadata<'_>,
    ) -> Result<AiBaseline, StoreError> {
        let query_id = query_id.trim();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        require_query_access(&transaction, query_id, payment_token_hash)?;
        let liquidity_state = transaction
            .query_row(
                "SELECT liquidity_state FROM queries WHERE id = ?1",
                [query_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("query"))?;
        if liquidity_state == "human_covered" {
            return Err(StoreError::Conflict(
                "human coverage is sufficient; AI liquidity is disabled".to_owned(),
            ));
        }
        let generated_at = now_ms();
        let expires_at = generated_at.saturating_add(metadata.ttl_ms.max(60_000));
        transaction.execute(
            "INSERT INTO ai_baselines
             (id, query_id, orientation, general_points_json, human_gaps_json,
              questions_for_people_json, model, mode, policy_version, generated_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(query_id) DO UPDATE SET
               id = excluded.id,
               orientation = excluded.orientation,
               general_points_json = excluded.general_points_json,
               human_gaps_json = excluded.human_gaps_json,
               questions_for_people_json = excluded.questions_for_people_json,
               model = excluded.model,
               mode = excluded.mode,
               policy_version = excluded.policy_version,
               generated_at = excluded.generated_at,
               expires_at = excluded.expires_at
             WHERE ai_baselines.expires_at <= ?10",
            params![
                new_id("baseline"),
                query_id,
                draft.orientation.trim(),
                serde_json::to_string(&draft.general_points)
                    .expect("AI baseline points are serialisable"),
                serde_json::to_string(&draft.human_gaps)
                    .expect("AI baseline gaps are serialisable"),
                serde_json::to_string(&draft.questions_for_people)
                    .expect("AI baseline questions are serialisable"),
                metadata.model.trim(),
                metadata.mode.trim(),
                metadata.policy_version.trim(),
                as_i64(generated_at)?,
                as_i64(expires_at)?,
            ],
        )?;
        transaction.commit()?;
        load_ai_baseline(&connection, query_id, generated_at)?
            .ok_or_else(|| StoreError::Validation("AI baseline was not persisted".to_owned()))
    }

    pub fn list_shelf_starters(&self, user_id: &str) -> Result<Vec<ShelfStarter>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, prompt, rationale, category, generated_at, expires_at
             FROM shelf_starters
             WHERE user_id = ?1 AND answered_at IS NULL AND expires_at > ?2
             ORDER BY generated_at DESC LIMIT 3",
        )?;
        Ok(statement
            .query_map(params![user_id, as_i64(now_ms())?], shelf_starter_from_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn record_shelf_starters(
        &self,
        user_id: &str,
        drafts: &[ShelfStarterDraft],
        model: &str,
        mode: &str,
        policy_version: &str,
        ttl_ms: u64,
    ) -> Result<Vec<ShelfStarter>, StoreError> {
        if drafts.len() != 3 {
            return Err(StoreError::Validation(
                "exactly three shelf starters are required".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let profile = load_profile(&transaction, user_id)?.ok_or_else(|| {
            StoreError::Conflict("complete onboarding before building your shelf".to_owned())
        })?;
        let generated_at = now_ms();
        let expires_at = generated_at.saturating_add(ttl_ms.max(60_000));
        transaction.execute(
            "DELETE FROM shelf_starters
             WHERE user_id = ?1 AND answered_at IS NULL",
            [user_id],
        )?;
        for draft in drafts {
            if !profile.speaks_to.contains(&draft.category)
                || !CATEGORY_IDS.contains(&draft.category.as_str())
                || draft.prompt.trim().chars().count() < 20
                || draft.prompt.chars().count() > 400
            {
                return Err(StoreError::Validation(
                    "AI shelf starter is outside the contributor profile".to_owned(),
                ));
            }
            transaction.execute(
                "INSERT INTO shelf_starters
                 (id, user_id, prompt, rationale, category, model, mode, policy_version,
                  generated_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    new_id("starter"),
                    user_id,
                    draft.prompt.trim(),
                    draft.rationale.trim(),
                    draft.category,
                    model.trim(),
                    mode.trim(),
                    policy_version.trim(),
                    as_i64(generated_at)?,
                    as_i64(expires_at)?,
                ],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.list_shelf_starters(user_id)
    }

    pub fn submit_shelf_starter_answer(
        &self,
        user_id: &str,
        starter_id: &str,
        answer: &str,
        price_krw: u64,
    ) -> Result<SubmitShelfStarterAnswerResponse, StoreError> {
        if answer.trim().is_empty() || answer.chars().count() > 10_000 {
            return Err(StoreError::Validation(
                "answer must contain 1 to 10000 characters".to_owned(),
            ));
        }
        if !(5..=10_000).contains(&price_krw) {
            return Err(StoreError::Validation(
                "future open price must be between ₩5 and ₩10,000".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let strikes = transaction.query_row(
            "SELECT COUNT(*) FROM memory_entries WHERE user_id = ?1 AND status = 'voided'",
            [user_id],
            |row| as_usize(row.get(0)?),
        )?;
        if strikes >= STRIKE_LIMIT {
            return Err(StoreError::Conflict(
                "this account is suspended after three strikes".to_owned(),
            ));
        }
        let profile = load_profile(&transaction, user_id)?.ok_or_else(|| {
            StoreError::Conflict("complete onboarding before building your shelf".to_owned())
        })?;
        let now = now_ms();
        let starter = transaction
            .query_row(
                "SELECT prompt, category FROM shelf_starters
                 WHERE id = ?1 AND user_id = ?2 AND answered_at IS NULL AND expires_at > ?3",
                params![starter_id, user_id, as_i64(now)?],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("active shelf starter"))?;
        let mut issues = quality::assess(&starter.0, answer);
        let mut prior = transaction.prepare(
            "SELECT answer FROM memory_entries WHERE user_id = ?1 AND status = 'settled' LIMIT 100",
        )?;
        let duplicate = prior
            .query_map([user_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|existing| quality::near_duplicate(existing, answer));
        drop(prior);
        if duplicate {
            issues.push(AnswerIssue {
                rule: "Duplicate answer".to_owned(),
                detail: "This substantially duplicates an answer already stored in your memory."
                    .to_owned(),
            });
        }
        if let Some(issue) = issues.first() {
            return Err(StoreError::Validation(format!(
                "{}: {}",
                issue.rule, issue.detail
            )));
        }

        let document_id = new_id("md");
        let handle = handle_from_id(&document_id);
        let memory_id = new_id("memory");
        let reliability = author_reliability(&transaction, user_id)?;
        let shelf = format!("{} field notes", starter.1);
        let content_hash = sha256_hex(answer.trim());
        let importance = memory_importance(&starter.0, answer, &[]);
        insert_document(
            &transaction,
            &Document {
                id: document_id.clone(),
                handle: handle.clone(),
                author_id: user_id.to_owned(),
                shelf_id: slug(&shelf),
                shelf: shelf.clone(),
                category: starter.1.clone(),
                content: answer.trim().to_owned(),
                tags: starter
                    .0
                    .split_whitespace()
                    .take(12)
                    .map(|term| term.trim_matches(|c: char| !c.is_alphanumeric()).to_owned())
                    .filter(|term| !term.is_empty())
                    .collect(),
                price_krw,
                age_days: 0,
                quality_score: quality::quality_score(&starter.0, answer),
                reliability_score: reliability,
                locked: false,
                demographics: Some(DemographicBands {
                    age_band: profile.age_band.clone(),
                    region: profile.region.clone(),
                    household: profile.household.clone(),
                    field: profile.field.clone(),
                }),
            },
            now,
        )?;
        transaction.execute(
            "INSERT INTO memory_entries
             (id, user_id, document_id, question, answer, shelf, earned_krw, created_at,
              via, status, flags_json, interview_json, memory_type, importance,
              reliability_score, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'Shelf starter', 'settled',
                     '[]', '[]', 'observation', ?8, ?9, ?10)",
            params![
                memory_id,
                user_id,
                document_id,
                starter.0,
                answer.trim(),
                shelf,
                as_i64(now)?,
                importance,
                reliability,
                content_hash,
            ],
        )?;
        transaction.execute(
            "UPDATE shelf_starters SET answered_at = ?1, document_id = ?2 WHERE id = ?3",
            params![as_i64(now)?, document_id, starter_id],
        )?;
        let updated_reliability = author_reliability(&transaction, user_id)?;
        transaction.execute(
            "UPDATE memory_entries SET reliability_score = ?1 WHERE id = ?2",
            params![updated_reliability, memory_id],
        )?;
        transaction.execute(
            "UPDATE documents SET reliability_score = ?1 WHERE author_id = ?2",
            params![updated_reliability, user_id],
        )?;
        maybe_create_reflection(&transaction, user_id, now, updated_reliability)?;
        transaction.commit()?;

        Ok(SubmitShelfStarterAnswerResponse {
            document_handle: handle,
            memory: MemoryEntry {
                id: memory_id,
                question: starter.0,
                answer: answer.trim().to_owned(),
                shelf,
                earned: 0,
                created_at: now,
                via: "Shelf starter".to_owned(),
                status: "settled".to_owned(),
                flags: Vec::new(),
                rating: None,
                dispute_status: None,
                interview_responses: Vec::new(),
                memory_type: "observation".to_owned(),
                importance,
                reliability_score: updated_reliability,
                content_hash,
                version: 1,
                locked: false,
                access_count: 0,
                last_accessed_at: None,
                source_ids: Vec::new(),
            },
        })
    }

    pub fn payment_progress(
        &self,
        query_id: &str,
        payer: &str,
        payment_token_hash: &str,
    ) -> Result<PaymentProgress, StoreError> {
        let query_id = query_id.trim();
        let payer = payer.trim();
        if !valid_solana_address(payer) {
            return Err(StoreError::Validation(
                "payer must be a base58 Solana public key".to_owned(),
            ));
        }
        let connection = self.connection()?;
        require_query_access(&connection, query_id, payment_token_hash)?;

        let mut statement = connection.prepare(
            "SELECT document_handle, quoted_price_krw
             FROM query_matches WHERE query_id = ?1 ORDER BY rank ASC",
        )?;
        let matches = statement
            .query_map([query_id], |row| {
                Ok((row.get::<_, String>(0)?, as_u64(row.get(1)?)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let now = now_ms();
        let mut documents = Vec::with_capacity(matches.len());
        let mut settled_count = 0_usize;
        let mut settled_price_krw = 0_u64;
        let mut total_price_krw = 0_u64;
        for (handle, price_krw) in matches {
            total_price_krw = total_price_krw.saturating_add(price_krw);
            let settlement = connection
                .query_row(
                    "SELECT pq.id, cs.transaction_signature, cs.network, cs.confirmed_at
                     FROM payment_quotes pq
                     JOIN chain_settlements cs ON cs.quote_id = pq.id
                     WHERE pq.query_id = ?1 AND pq.document_handle = ?2
                       AND cs.payer = ?3
                     ORDER BY cs.confirmed_at DESC LIMIT 1",
                    params![query_id, handle, payer],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            as_u64(row.get(3)?)?,
                        ))
                    },
                )
                .optional()?;
            let settlement = if settlement.is_some() {
                settlement
            } else {
                connection
                    .query_row(
                        "SELECT pbq.id, bcs.transaction_signature, bcs.network, bcs.confirmed_at
                         FROM payment_bundle_quotes pbq
                         JOIN payment_bundle_documents pbd ON pbd.quote_id = pbq.id
                         JOIN bundle_chain_settlements bcs ON bcs.quote_id = pbq.id
                         WHERE pbq.query_id = ?1 AND pbd.document_handle = ?2
                           AND bcs.payer = ?3 AND pbq.status IN ('delivered', 'completed')
                           AND (pbq.status = 'delivered' OR EXISTS (
                             SELECT 1 FROM payment_quotes paid
                             WHERE paid.id = pbd.pay_sh_quote_id AND paid.status = 'delivered'
                           ))
                         ORDER BY bcs.confirmed_at DESC LIMIT 1",
                        params![query_id, handle, payer],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                as_u64(row.get(3)?)?,
                            ))
                        },
                    )
                    .optional()?
            };
            if let Some((quote_id, signature, network, settled_at)) = settlement {
                settled_count += 1;
                settled_price_krw = settled_price_krw.saturating_add(price_krw);
                documents.push(PaymentDocumentProgress {
                    handle,
                    price_krw,
                    status: "settled".to_owned(),
                    quote_id: Some(quote_id),
                    quote_expires_at: None,
                    transaction_signature: Some(signature),
                    network: Some(network),
                    settled_at: Some(settled_at),
                });
                continue;
            }

            let active_quote = connection
                .query_row(
                    "SELECT id, expires_at, network FROM payment_quotes
                     WHERE query_id = ?1 AND document_handle = ?2
                       AND settled_at IS NULL AND expires_at > ?3
                     ORDER BY created_at DESC LIMIT 1",
                    params![query_id, handle, as_i64(now)?],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            as_u64(row.get(1)?)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let active_quote = if active_quote.is_some() {
                active_quote
            } else {
                connection
                    .query_row(
                        "SELECT pbq.id, pbq.expires_at, pbq.network
                         FROM payment_bundle_quotes pbq
                         JOIN payment_bundle_documents pbd ON pbd.quote_id = pbq.id
                         WHERE pbq.query_id = ?1 AND pbd.document_handle = ?2
                           AND pbq.settled_at IS NULL AND pbq.expires_at > ?3
                         ORDER BY pbq.created_at DESC LIMIT 1",
                        params![query_id, handle, as_i64(now)?],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                as_u64(row.get(1)?)?,
                                row.get::<_, String>(2)?,
                            ))
                        },
                    )
                    .optional()?
            };
            let (status, quote_id, quote_expires_at, network) =
                if let Some((quote_id, expires_at, network)) = active_quote {
                    (
                        "quoted".to_owned(),
                        Some(quote_id),
                        Some(expires_at),
                        Some(network),
                    )
                } else {
                    ("unpaid".to_owned(), None, None, None)
                };
            documents.push(PaymentDocumentProgress {
                handle,
                price_krw,
                status,
                quote_id,
                quote_expires_at,
                transaction_signature: None,
                network,
                settled_at: None,
            });
        }

        Ok(PaymentProgress {
            query_id: query_id.to_owned(),
            payer: payer.to_owned(),
            document_count: documents.len(),
            settled_count,
            unpaid_count: documents.len().saturating_sub(settled_count),
            total_price_krw,
            settled_price_krw,
            documents,
        })
    }

    pub fn recover_paid_document(
        &self,
        query_id: &str,
        handle: &str,
        payer: &str,
        payment_token_hash: &str,
    ) -> Result<RecoveredPaidDocument, StoreError> {
        let query_id = query_id.trim();
        let handle = handle.trim();
        let payer = payer.trim();
        if !valid_solana_address(payer) {
            return Err(StoreError::Validation(
                "payer must be a base58 Solana public key".to_owned(),
            ));
        }
        let connection = self.connection()?;
        require_query_access(&connection, query_id, payment_token_hash)?;
        let direct = connection
            .query_row(
                "SELECT pq.document_handle, pq.shelf_snapshot, pq.content_snapshot, pq.price_krw,
                        cs.id, cs.quote_id, cs.transaction_signature, cs.payer,
                        cs.pay_to, cs.amount_atomic, cs.network, cs.confirmed_at
                 FROM payment_quotes pq
                 JOIN chain_settlements cs ON cs.quote_id = pq.id
                 WHERE pq.query_id = ?1 AND pq.document_handle = ?2
                   AND cs.payer = ?3
                 ORDER BY cs.confirmed_at DESC LIMIT 1",
                params![query_id, handle, payer],
                |row| {
                    Ok(RecoveredPaidDocument {
                        citation: Citation {
                            handle: row.get(0)?,
                            shelf: row.get(1)?,
                            excerpt: row.get(2)?,
                            price: as_u64(row.get(3)?)?,
                        },
                        settlement: ChainSettlementReceipt {
                            id: row.get(4)?,
                            quote_id: row.get(5)?,
                            transaction_signature: row.get(6)?,
                            payer: row.get(7)?,
                            pay_to: row.get(8)?,
                            amount_atomic: as_u64(row.get(9)?)?.to_string(),
                            network: row.get(10)?,
                            confirmed_at: as_u64(row.get(11)?)?,
                        },
                    })
                },
            )
            .optional()?;
        if let Some(direct) = direct {
            return Ok(direct);
        }
        connection
            .query_row(
                "SELECT pbd.document_handle, pbd.shelf_snapshot, pbd.content_snapshot,
                        pbd.price_krw, bcs.id, bcs.quote_id, bcs.transaction_signature,
                        bcs.payer, bcs.pay_to, bcs.amount_atomic, bcs.network, bcs.confirmed_at
                 FROM payment_bundle_documents pbd
                 JOIN payment_bundle_quotes pbq ON pbq.id = pbd.quote_id
                 JOIN bundle_chain_settlements bcs ON bcs.quote_id = pbq.id
                 WHERE pbq.query_id = ?1 AND pbd.document_handle = ?2 AND bcs.payer = ?3
                   AND pbq.status IN ('delivered', 'completed')
                   AND (pbq.status = 'delivered' OR EXISTS (
                     SELECT 1 FROM payment_quotes paid
                     WHERE paid.id = pbd.pay_sh_quote_id AND paid.status = 'delivered'
                   ))
                 ORDER BY bcs.confirmed_at DESC LIMIT 1",
                params![query_id, handle, payer],
                |row| {
                    Ok(RecoveredPaidDocument {
                        citation: Citation {
                            handle: row.get(0)?,
                            shelf: row.get(1)?,
                            excerpt: row.get(2)?,
                            price: as_u64(row.get(3)?)?,
                        },
                        settlement: ChainSettlementReceipt {
                            id: row.get(4)?,
                            quote_id: row.get(5)?,
                            transaction_signature: row.get(6)?,
                            payer: row.get(7)?,
                            pay_to: row.get(8)?,
                            amount_atomic: as_u64(row.get(9)?)?.to_string(),
                            network: row.get(10)?,
                            confirmed_at: as_u64(row.get(11)?)?,
                        },
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("settled document"))
    }

    pub fn submit_document_feedback(
        &self,
        query_id: &str,
        handle: &str,
        payer: &str,
        payment_token_hash: &str,
        request: &SubmitDocumentFeedbackRequest,
    ) -> Result<DocumentFeedback, StoreError> {
        let query_id = query_id.trim();
        let handle = handle.trim();
        let payer = payer.trim();
        let outcome = request.outcome.trim();
        if !valid_solana_address(payer) {
            return Err(StoreError::Validation(
                "payer must be a base58 Solana public key".to_owned(),
            ));
        }
        if !["helpful", "not_helpful", "report"].contains(&outcome) {
            return Err(StoreError::Validation(
                "outcome must be helpful, not_helpful, or report".to_owned(),
            ));
        }
        let reason = request
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if reason.is_some_and(|value| value.chars().count() > 1_000) {
            return Err(StoreError::Validation(
                "feedback reason must be 1000 characters or fewer".to_owned(),
            ));
        }
        if outcome == "report" && reason.is_none_or(|value| value.chars().count() < 20) {
            return Err(StoreError::Validation(
                "a report reason must be between 20 and 1000 characters".to_owned(),
            ));
        }

        let mut connection = self.connection()?;
        require_query_access(&connection, query_id, payment_token_hash)?;
        let transaction = connection.transaction()?;
        let (document_id, settlement_id) = transaction
            .query_row(
                "SELECT pq.document_id, cs.id, cs.confirmed_at AS confirmed_at
                 FROM payment_quotes pq
                 JOIN chain_settlements cs ON cs.quote_id = pq.id
                 WHERE pq.query_id = ?1 AND pq.document_handle = ?2 AND cs.payer = ?3
                 UNION ALL
                 SELECT pbd.document_id, bcs.settlement_id || ':' || pbd.document_id,
                        bcs.confirmed_at AS confirmed_at
                 FROM payment_bundle_documents pbd
                 JOIN payment_bundle_quotes pbq ON pbq.id = pbd.quote_id
                 JOIN bundle_chain_settlements bcs ON bcs.quote_id = pbq.id
                 WHERE pbq.query_id = ?1 AND pbd.document_handle = ?2 AND bcs.payer = ?3
                   AND pbq.status IN ('delivered', 'completed')
                   AND (pbq.status = 'delivered' OR EXISTS (
                     SELECT 1 FROM payment_quotes paid
                     WHERE paid.id = pbd.pay_sh_quote_id AND paid.status = 'delivered'
                   ))
                 ORDER BY confirmed_at DESC LIMIT 1",
                params![query_id, handle, payer],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("settled document"))?;
        let existing = transaction
            .query_row(
                "SELECT id, query_id, document_handle, payer, outcome, reason, status,
                        review_note, created_at, reviewed_at
                 FROM document_feedback WHERE settlement_id = ?1",
                [&settlement_id],
                document_feedback_from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.outcome == outcome && existing.reason.as_deref() == reason {
                return Ok(existing);
            }
            return Err(StoreError::Conflict(
                "feedback has already been submitted for this purchase".to_owned(),
            ));
        }

        let id = new_id("feedback");
        let created_at = now_ms();
        let status = if outcome == "report" {
            "pending"
        } else {
            "recorded"
        };
        transaction.execute(
            "INSERT INTO document_feedback
             (id, query_id, document_id, document_handle, settlement_id, payer,
              outcome, reason, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                query_id,
                document_id,
                handle,
                settlement_id,
                payer,
                outcome,
                reason,
                status,
                as_i64(created_at)?,
            ],
        )?;
        recompute_document_reliability(&transaction, &document_id)?;
        transaction.commit()?;
        Ok(DocumentFeedback {
            id,
            query_id: query_id.to_owned(),
            document_handle: handle.to_owned(),
            payer: payer.to_owned(),
            outcome: outcome.to_owned(),
            reason: reason.map(ToOwned::to_owned),
            status: status.to_owned(),
            review_note: None,
            created_at,
            reviewed_at: None,
        })
    }

    pub fn list_open_calls(&self, user_id: Option<&str>) -> Result<Vec<OpenCall>, StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM open_call_reservations WHERE expires_at <= ?1",
            [as_i64(now_ms())?],
        )?;
        let profile = if let Some(user_id) = user_id {
            load_profile(&connection, user_id)?
        } else {
            None
        };
        let mut statement = connection.prepare(
            "SELECT id, owner_id, question, unit_price_krw, target, answered,
                    created_at, chat_id, shelf, category, target_age_band,
                    target_region, target_household, target_field,
                    escrow_remaining_krw, status, escrow_mode, escrow_wallet,
                    escrow_asset, escrow_network, escrow_total_atomic,
                    escrow_remaining_atomic, funding_transaction_signature, payer_wallet
             FROM open_calls
             WHERE status IN ('open', 'filled')
                OR (status = 'cancelled' AND owner_id = ?1)
             ORDER BY created_at DESC",
        )?;
        let stored_calls = statement
            .query_map([user_id], stored_call_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut calls = Vec::with_capacity(stored_calls.len());
        for stored in stored_calls {
            let mut call = stored.public(user_id, profile.as_ref());
            call.reserved_slots = active_reservation_count(&connection, &call.id)?;
            if let Some(user_id) = user_id {
                call.reservation_expires_at =
                    active_reservation_expiry(&connection, &call.id, user_id)?;
                if let Some(profile) = profile.as_ref() {
                    let (score, reasons) =
                        call_recommendation(&connection, user_id, profile, &stored)?;
                    call.recommendation_score = score;
                    call.recommendation_reason = reasons;
                }
            }
            calls.push(call);
        }
        Ok(calls)
    }

    pub fn create_open_call(
        &self,
        owner_id: &str,
        request: &CreateOpenCallRequest,
    ) -> Result<OpenCall, StoreError> {
        validate_open_call(request)?;
        let id = new_id("call");
        let created_at = now_ms();
        let mut effective_filters = request.filters.clone();
        effective_filters.category = Some(request.category.trim().to_owned());
        let total = request
            .unit_price
            .checked_mul(request.target as u64)
            .ok_or_else(|| StoreError::Validation("open-call budget is too large".to_owned()))?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE balances
             SET available_krw = available_krw - ?1,
                 reserved_krw = reserved_krw + ?1,
                 updated_at = ?2
             WHERE user_id = ?3 AND available_krw >= ?1",
            params![as_i64(total)?, as_i64(created_at)?, owner_id],
        )?;
        if changed == 0 {
            return Err(StoreError::Conflict(
                "insufficient sandbox balance to reserve this open call".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO open_calls
             (id, owner_id, question, unit_price_krw, target, answered, created_at,
              chat_id, shelf, category, status, escrow_remaining_krw,
              target_age_band, target_region, target_household, target_field)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, 'open', ?10,
                     ?11, ?12, ?13, ?14)",
            params![
                id,
                owner_id,
                request.question.trim(),
                as_i64(request.unit_price)?,
                request.target as i64,
                as_i64(created_at)?,
                request.chat_id,
                request.shelf.trim(),
                request.category.trim(),
                as_i64(total)?,
                request.filters.age_band,
                request.filters.region,
                request.filters.household,
                request.filters.field,
            ],
        )?;
        transaction.execute(
            "INSERT INTO funding_events
             (id, user_id, open_call_id, kind, amount_krw, created_at)
             VALUES (?1, ?2, ?3, 'open_call_reserved', ?4, ?5)",
            params![
                new_id("fund"),
                owner_id,
                id,
                as_i64(total)?,
                as_i64(created_at)?
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        if let Err(error) = self.run_call_agents(&id) {
            tracing::warn!(open_call_id = %id, %error, "memory-agent pass failed after call creation");
        }
        if let Err(error) = self.create_notifications_for_call(&id) {
            tracing::warn!(open_call_id = %id, %error, "contributor notification fanout failed after call creation");
        }
        self.list_open_calls(Some(owner_id))?
            .into_iter()
            .find(|call| call.id == id)
            .ok_or(StoreError::NotFound("open call"))
    }

    pub fn create_open_call_funding_quote(
        &self,
        owner_id: &str,
        request: &CreateOpenCallRequest,
        policy: &PaymentQuotePolicy,
    ) -> Result<OpenCallFundingQuote, StoreError> {
        validate_open_call(request)?;
        validate_payment_policy(policy)?;
        if request.unit_price == 0 {
            return Err(StoreError::Validation(
                "a Devnet-funded open call must have a positive unit price".to_owned(),
            ));
        }
        let pay_to = policy
            .bundle_recipient
            .as_deref()
            .filter(|wallet| valid_solana_address(wallet.trim()))
            .ok_or_else(|| {
                StoreError::Validation(
                    "a valid OPENSHELF_BUNDLE_RECEIVER is required for funded open calls"
                        .to_owned(),
                )
            })?
            .trim()
            .to_owned();
        let total_price_krw = request
            .unit_price
            .checked_mul(request.target as u64)
            .ok_or_else(|| StoreError::Validation("open-call budget is too large".to_owned()))?;
        let amount_atomic = krw_to_usdc_atomic(total_price_krw, policy.krw_per_usdc)?;
        let request_json = serde_json::to_string(request)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        let payload_hash = sha256_hex(&request_json);
        let now = now_ms();
        let expires_at = now.saturating_add(policy.ttl_ms);
        let connection = self.connection()?;
        if let Some(quote) = connection
            .query_row(
                "SELECT id, pay_to, network, asset, amount_atomic, total_price_krw,
                        krw_per_usdc, expires_at, payload_hash, status, open_call_id
                 FROM open_call_funding_quotes
                 WHERE owner_id = ?1 AND payload_hash = ?2 AND status = 'quoted'
                   AND expires_at > ?3 ORDER BY created_at DESC LIMIT 1",
                params![owner_id, payload_hash, as_i64(now)?],
                open_call_funding_quote_from_row,
            )
            .optional()?
        {
            return Ok(quote);
        }
        let id = new_id("call-quote");
        connection.execute(
            "INSERT INTO open_call_funding_quotes
             (id, owner_id, request_json, payload_hash, pay_to, network, asset,
              amount_atomic, total_price_krw, krw_per_usdc, expires_at, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'quoted', ?12)",
            params![
                id,
                owner_id,
                request_json,
                payload_hash,
                pay_to,
                policy.network.trim(),
                policy.asset.trim(),
                as_i64(amount_atomic)?,
                as_i64(total_price_krw)?,
                as_i64(policy.krw_per_usdc)?,
                as_i64(expires_at)?,
                as_i64(now)?,
            ],
        )?;
        drop(connection);
        self.open_call_funding_quote_for_owner(&id, owner_id)
    }

    pub fn open_call_funding_quote(
        &self,
        quote_id: &str,
    ) -> Result<OpenCallFundingQuote, StoreError> {
        self.connection()?
            .query_row(
                "SELECT id, pay_to, network, asset, amount_atomic, total_price_krw,
                        krw_per_usdc, expires_at, payload_hash, status, open_call_id
                 FROM open_call_funding_quotes WHERE id = ?1",
                [quote_id.trim()],
                open_call_funding_quote_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("open-call funding quote"))
    }

    pub fn open_call_funding_quote_for_owner(
        &self,
        quote_id: &str,
        owner_id: &str,
    ) -> Result<OpenCallFundingQuote, StoreError> {
        self.connection()?
            .query_row(
                "SELECT id, pay_to, network, asset, amount_atomic, total_price_krw,
                        krw_per_usdc, expires_at, payload_hash, status, open_call_id
                 FROM open_call_funding_quotes WHERE id = ?1 AND owner_id = ?2",
                params![quote_id.trim(), owner_id],
                open_call_funding_quote_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("open-call funding quote"))
    }

    pub fn open_call_funding_snapshot(
        &self,
        quote_id: &str,
    ) -> Result<OpenCallFundingSnapshot, StoreError> {
        let connection = self.connection()?;
        let (request_json, payload_hash, total_price_krw): (String, String, u64) = connection
            .query_row(
                "SELECT request_json, payload_hash, total_price_krw
                 FROM open_call_funding_quotes WHERE id = ?1",
                [quote_id.trim()],
                |row| Ok((row.get(0)?, row.get(1)?, as_u64(row.get(2)?)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("open-call funding quote"))?;
        let request: CreateOpenCallRequest = serde_json::from_str(&request_json)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        Ok(OpenCallFundingSnapshot {
            quote_id: quote_id.trim().to_owned(),
            question: request.question,
            target: request.target,
            unit_price_krw: request.unit_price,
            total_price_krw,
            payload_hash,
        })
    }

    pub fn record_open_call_chain_settlement(
        &self,
        request: &RecordChainSettlementRequest,
    ) -> Result<ChainSettlementReceipt, StoreError> {
        validate_chain_settlement_request(request)?;
        let amount_atomic = request.amount_atomic.parse::<u64>().map_err(|_| {
            StoreError::Validation("amountAtomic must be an unsigned integer".to_owned())
        })?;
        let raw_response_json = settlement_raw_json(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT id, quote_id, transaction_signature, payer, pay_to,
                        amount_atomic, network, confirmed_at
                 FROM open_call_chain_settlements WHERE quote_id = ?1",
                [request.quote_id.trim()],
                chain_settlement_from_row,
            )
            .optional()?
        {
            if existing.transaction_signature == request.transaction_signature.trim()
                && existing.payer == request.payer.trim()
                && existing.pay_to == request.pay_to.trim()
                && existing.amount_atomic == request.amount_atomic
                && existing.network == request.network.trim()
            {
                return Ok(existing);
            }
            return Err(StoreError::Conflict(
                "this open-call funding quote has already been settled".to_owned(),
            ));
        }
        let signature = request.transaction_signature.trim();
        let signature_used = transaction
            .query_row(
                "SELECT 1 FROM chain_settlements WHERE transaction_signature = ?1
                 UNION ALL SELECT 1 FROM bundle_chain_settlements WHERE transaction_signature = ?1
                 UNION ALL SELECT 1 FROM open_call_chain_settlements WHERE transaction_signature = ?1
                 LIMIT 1",
                [signature],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if signature_used {
            return Err(StoreError::Conflict(
                "this transaction signature has already been recorded".to_owned(),
            ));
        }
        let (
            owner_id,
            request_json,
            pay_to,
            network,
            asset,
            quoted_atomic,
            total_krw,
            expiry,
            status,
        ): (
            String,
            String,
            String,
            String,
            String,
            u64,
            u64,
            u64,
            String,
        ) = transaction
            .query_row(
                "SELECT owner_id, request_json, pay_to, network, asset, amount_atomic,
                        total_price_krw, expires_at, status
                 FROM open_call_funding_quotes WHERE id = ?1",
                [request.quote_id.trim()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        as_u64(row.get(5)?)?,
                        as_u64(row.get(6)?)?,
                        as_u64(row.get(7)?)?,
                        row.get(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("open-call funding quote"))?;
        if status != "quoted" {
            return Err(StoreError::Conflict(
                "this funding quote is no longer payable".to_owned(),
            ));
        }
        if expiry <= now_ms() {
            return Err(StoreError::Conflict(
                "this funding quote has expired".to_owned(),
            ));
        }
        if pay_to != request.pay_to.trim()
            || network != request.network.trim()
            || quoted_atomic != amount_atomic
        {
            return Err(StoreError::Conflict(
                "settlement does not match the open-call funding quote".to_owned(),
            ));
        }
        let call_request: CreateOpenCallRequest = serde_json::from_str(&request_json)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        validate_open_call(&call_request)?;
        let call_id = new_id("call");
        let settlement_id = new_id("call-chain");
        let confirmed_at = now_ms();
        transaction.execute(
            "INSERT INTO open_calls
             (id, owner_id, question, unit_price_krw, target, answered, created_at,
              chat_id, shelf, category, status, escrow_remaining_krw,
              target_age_band, target_region, target_household, target_field,
              escrow_mode, escrow_wallet, escrow_asset, escrow_network,
              escrow_total_atomic, escrow_remaining_atomic,
              funding_transaction_signature, payer_wallet)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, 'open', ?10,
                     ?11, ?12, ?13, ?14, 'x402_solana_escrow', ?15, ?16, ?17,
                     ?18, ?18, ?19, ?20)",
            params![
                call_id,
                owner_id,
                call_request.question.trim(),
                as_i64(call_request.unit_price)?,
                call_request.target as i64,
                as_i64(confirmed_at)?,
                call_request.chat_id,
                call_request.shelf.trim(),
                call_request.category.trim(),
                as_i64(total_krw)?,
                call_request.filters.age_band,
                call_request.filters.region,
                call_request.filters.household,
                call_request.filters.field,
                pay_to,
                asset,
                network,
                as_i64(amount_atomic)?,
                signature,
                request.payer.trim(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO open_call_chain_settlements
             (id, quote_id, open_call_id, transaction_signature, payer, pay_to,
              amount_atomic, network, raw_response_json, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                settlement_id,
                request.quote_id.trim(),
                call_id,
                signature,
                request.payer.trim(),
                request.pay_to.trim(),
                as_i64(amount_atomic)?,
                request.network.trim(),
                raw_response_json,
                as_i64(confirmed_at)?,
            ],
        )?;
        transaction.execute(
            "UPDATE open_call_funding_quotes
             SET status = 'funded', open_call_id = ?1, payer_wallet = ?2, settled_at = ?3
             WHERE id = ?4",
            params![
                call_id,
                request.payer.trim(),
                as_i64(confirmed_at)?,
                request.quote_id.trim()
            ],
        )?;
        transaction.execute(
            "INSERT INTO funding_events
             (id, user_id, open_call_id, kind, amount_krw, created_at)
             VALUES (?1, ?2, ?3, 'open_call_onchain_funded', ?4, ?5)",
            params![
                new_id("fund"),
                owner_id,
                call_id,
                as_i64(total_krw)?,
                as_i64(confirmed_at)?
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        if let Err(error) = self.run_call_agents(&call_id) {
            tracing::warn!(open_call_id = %call_id, %error, "memory-agent pass failed after funded call creation");
        }
        if let Err(error) = self.create_notifications_for_call(&call_id) {
            tracing::warn!(open_call_id = %call_id, %error, "contributor notification fanout failed after funded call creation");
        }
        Ok(ChainSettlementReceipt {
            id: settlement_id,
            quote_id: request.quote_id.trim().to_owned(),
            transaction_signature: signature.to_owned(),
            payer: request.payer.trim().to_owned(),
            pay_to,
            amount_atomic: amount_atomic.to_string(),
            network,
            confirmed_at,
        })
    }

    pub fn reserve_open_call(
        &self,
        open_call_id: &str,
        user_id: &str,
    ) -> Result<OpenCallReservation, StoreError> {
        let now = now_ms();
        let expires_at = now.saturating_add(ANSWER_RESERVATION_TTL_MS);
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM open_call_reservations WHERE expires_at <= ?1",
            [as_i64(now)?],
        )?;
        let call = load_call(&transaction, open_call_id)?;
        if call.status != "open" || call.answered >= call.target {
            return Err(StoreError::Conflict(
                "this open call is no longer accepting answers".to_owned(),
            ));
        }
        if call.owner_id == user_id {
            return Err(StoreError::Conflict(
                "you cannot reserve your own open call".to_owned(),
            ));
        }
        let profile = load_profile(&transaction, user_id)?.ok_or_else(|| {
            StoreError::Conflict("complete onboarding before reserving a call".to_owned())
        })?;
        if profile.suspended || !profile_matches(&profile, &call.filters) {
            return Err(StoreError::Conflict(
                "your profile cannot reserve this call".to_owned(),
            ));
        }
        let already_answered = transaction
            .query_row(
                "SELECT 1 FROM memory_entries WHERE open_call_id = ?1 AND user_id = ?2",
                params![open_call_id, user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if already_answered {
            return Err(StoreError::Conflict(
                "you have already answered this open call".to_owned(),
            ));
        }
        let existing = transaction
            .query_row(
                "SELECT id FROM open_call_reservations
                 WHERE open_call_id = ?1 AND user_id = ?2 AND expires_at > ?3",
                params![open_call_id, user_id, as_i64(now)?],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let active = transaction.query_row(
            "SELECT COUNT(*) FROM open_call_reservations
             WHERE open_call_id = ?1 AND expires_at > ?2 AND user_id <> ?3",
            params![open_call_id, as_i64(now)?, user_id],
            |row| as_usize(row.get(0)?),
        )?;
        if existing.is_none() && active >= call.target.saturating_sub(call.answered) {
            return Err(StoreError::Conflict(
                "all remaining answer slots are temporarily reserved".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO open_call_reservations
             (id, open_call_id, user_id, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(open_call_id, user_id) DO UPDATE SET expires_at = excluded.expires_at",
            params![
                existing.unwrap_or_else(|| new_id("reservation")),
                open_call_id,
                user_id,
                as_i64(expires_at)?,
                as_i64(now)?,
            ],
        )?;
        transaction.commit()?;
        Ok(OpenCallReservation {
            open_call_id: open_call_id.to_owned(),
            expires_at,
        })
    }

    pub fn release_open_call_reservation(
        &self,
        open_call_id: &str,
        user_id: &str,
    ) -> Result<(), StoreError> {
        self.connection()?.execute(
            "DELETE FROM open_call_reservations WHERE open_call_id = ?1 AND user_id = ?2",
            params![open_call_id, user_id],
        )?;
        Ok(())
    }

    pub fn list_notifications(
        &self,
        user_id: &str,
    ) -> Result<Vec<ContributorNotification>, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        materialize_call_notifications(&transaction, user_id)?;
        transaction.commit()?;
        let mut statement = connection.prepare(
            "SELECT id, kind, title, body, open_call_id, created_at, read_at
             FROM contributor_notifications WHERE user_id = ?1
             ORDER BY created_at DESC LIMIT 100",
        )?;
        Ok(statement
            .query_map([user_id], notification_from_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn mark_notifications_read(&self, user_id: &str, ids: &[String]) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let read_at = as_i64(now_ms())?;
        if ids.is_empty() {
            connection.execute(
                "UPDATE contributor_notifications SET read_at = ?1
                 WHERE user_id = ?2 AND read_at IS NULL",
                params![read_at, user_id],
            )?;
        } else {
            for id in ids {
                connection.execute(
                    "UPDATE contributor_notifications SET read_at = ?1
                     WHERE id = ?2 AND user_id = ?3",
                    params![read_at, id, user_id],
                )?;
            }
        }
        Ok(())
    }

    pub fn pending_emails(&self, limit: usize) -> Result<Vec<PendingEmail>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, recipient, subject, body FROM email_outbox
             WHERE status IN ('pending', 'retry') AND attempts < 5
             ORDER BY created_at ASC LIMIT ?1",
        )?;
        Ok(statement
            .query_map([limit.min(100) as i64], |row| {
                Ok(PendingEmail {
                    id: row.get(0)?,
                    recipient: row.get(1)?,
                    subject: row.get(2)?,
                    body: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn mark_email_delivered(&self, id: &str) -> Result<(), StoreError> {
        self.connection()?.execute(
            "UPDATE email_outbox SET status = 'delivered', delivered_at = ?1,
                    attempts = attempts + 1, last_error = NULL WHERE id = ?2",
            params![as_i64(now_ms())?, id],
        )?;
        Ok(())
    }

    pub fn mark_email_failed(&self, id: &str, error: &str) -> Result<(), StoreError> {
        self.connection()?.execute(
            "UPDATE email_outbox SET status = 'retry', attempts = attempts + 1,
                    last_error = ?1 WHERE id = ?2",
            params![error.chars().take(500).collect::<String>(), id],
        )?;
        Ok(())
    }

    fn create_notifications_for_call(&self, open_call_id: &str) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let call = load_call(&transaction, open_call_id)?;
        create_call_notifications(&transaction, &call)?;
        transaction.commit()?;
        Ok(())
    }

    fn run_call_agents(&self, open_call_id: &str) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let mut candidate_statement = transaction.prepare(
            "SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id
             WHERE p.agents = 1 AND p.auto_match = 1 AND u.deleted_at IS NULL
               AND p.user_id <> (SELECT owner_id FROM open_calls WHERE id = ?1)
               AND (SELECT COUNT(*) FROM memory_entries strikes
                    WHERE strikes.user_id = p.user_id AND strikes.status = 'voided') < ?2",
        )?;
        let candidates = candidate_statement
            .query_map(
                params![open_call_id, AUTO_MATCH_STRIKE_LIMIT as i64],
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        drop(candidate_statement);

        for user_id in candidates {
            let call = load_call(&transaction, open_call_id)?;
            if call.status != "open" || call.answered >= call.target {
                break;
            }
            let Some(profile) = load_profile(&transaction, &user_id)? else {
                continue;
            };
            if !profile_matches(&profile, &call.filters) {
                continue;
            }
            let already_answered = transaction
                .query_row(
                    "SELECT 1 FROM memory_entries WHERE open_call_id = ?1 AND user_id = ?2",
                    params![open_call_id, user_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if already_answered {
                continue;
            }
            let Some(source) = best_agent_memory(&transaction, &user_id, &call)? else {
                continue;
            };
            settle_agent_match(&transaction, &call, &user_id, &profile, &source)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn submit_answer(
        &self,
        open_call_id: &str,
        user_id: &str,
        answer: &str,
    ) -> Result<SubmitAnswerResponse, StoreError> {
        self.submit_answer_with_interview(open_call_id, user_id, answer, &[])
    }

    pub fn submit_answer_with_interview(
        &self,
        open_call_id: &str,
        user_id: &str,
        answer: &str,
        interview_responses: &[InterviewResponse],
    ) -> Result<SubmitAnswerResponse, StoreError> {
        if user_id.trim().is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        if answer.trim().is_empty() {
            return Err(StoreError::Validation("answer is required".to_owned()));
        }
        if answer.chars().count() > 10_000 {
            return Err(StoreError::Validation(
                "answer must be 10000 characters or fewer".to_owned(),
            ));
        }
        let interview_responses = validate_interview_responses(interview_responses)?;

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let user_id = user_id.trim();
        let strikes = transaction.query_row(
            "SELECT COUNT(*) FROM memory_entries WHERE user_id = ?1 AND status = 'voided'",
            [user_id],
            |row| as_usize(row.get(0)?),
        )?;
        if strikes >= STRIKE_LIMIT {
            return Err(StoreError::Conflict(
                "this account is suspended after three strikes".to_owned(),
            ));
        }
        let call = load_call(&transaction, open_call_id)?;
        if call.owner_id == user_id {
            return Err(StoreError::Conflict(
                "you cannot answer your own open call".to_owned(),
            ));
        }
        let profile = load_profile(&transaction, user_id)?;
        let Some(profile) = profile else {
            return Err(StoreError::Conflict(
                "complete onboarding before answering an open call".to_owned(),
            ));
        };
        let onchain_payout = if call.escrow_mode == "x402_solana_escrow" {
            let recipient_wallet = profile
                .wallet
                .as_deref()
                .filter(|_| profile.wallet_verified)
                .filter(|wallet| valid_solana_address(wallet))
                .ok_or_else(|| {
                    StoreError::Conflict(
                        "verify a Devnet payout wallet before answering this funded call"
                            .to_owned(),
                    )
                })?
                .to_owned();
            Some((recipient_wallet, open_call_answer_atomic(&call)?))
        } else {
            None
        };
        if !profile_matches(&profile, &call.filters) {
            return Err(StoreError::Conflict(
                "your profile does not match this call's targeting".to_owned(),
            ));
        }
        if call.answered >= call.target {
            return Err(StoreError::Conflict(
                "this open call is already full".to_owned(),
            ));
        }
        let already_answered = transaction
            .query_row(
                "SELECT 1 FROM memory_entries WHERE open_call_id = ?1 AND user_id = ?2",
                params![open_call_id, user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if already_answered {
            return Err(StoreError::Conflict(
                "you have already answered this open call".to_owned(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "DELETE FROM open_call_reservations WHERE expires_at <= ?1",
            [as_i64(now)?],
        )?;
        let owns_reservation = transaction
            .query_row(
                "SELECT 1 FROM open_call_reservations
                 WHERE open_call_id = ?1 AND user_id = ?2 AND expires_at > ?3",
                params![open_call_id, user_id, as_i64(now)?],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let active_reservations = transaction.query_row(
            "SELECT COUNT(*) FROM open_call_reservations
             WHERE open_call_id = ?1 AND expires_at > ?2 AND user_id <> ?3",
            params![open_call_id, as_i64(now)?, user_id],
            |row| as_usize(row.get(0)?),
        )?;
        if !owns_reservation && active_reservations >= call.target.saturating_sub(call.answered) {
            return Err(StoreError::Conflict(
                "all remaining slots are reserved; refresh and try another call".to_owned(),
            ));
        }

        let mut issues = quality::assess(&call.question, answer);
        let mut prior_answers = transaction.prepare(
            "SELECT answer FROM memory_entries WHERE user_id = ?1 AND status = 'settled' LIMIT 100",
        )?;
        let duplicate = prior_answers
            .query_map([user_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|prior| quality::near_duplicate(prior, answer));
        drop(prior_answers);
        if duplicate {
            issues.push(AnswerIssue {
                rule: "Duplicate answer".to_owned(),
                detail: "This substantially duplicates an answer already stored in your memory."
                    .to_owned(),
            });
        }
        let voided = !issues.is_empty();
        let created_at = now_ms();
        let memory_id = new_id("memory");
        let content_hash = sha256_hex(answer.trim());
        let mut reliability = author_reliability(&transaction, user_id)?;
        let importance = memory_importance(&call.question, answer, &interview_responses);
        let document_id = (!voided).then(|| new_id("md"));
        let handle = document_id.as_ref().map(|id| handle_from_id(id));

        if let (Some(document_id), Some(handle)) = (&document_id, &handle) {
            let document =
                Document {
                    id: document_id.clone(),
                    handle: handle.clone(),
                    author_id: user_id.to_owned(),
                    shelf_id: slug(&call.shelf),
                    shelf: call.shelf.clone(),
                    category: call.category.clone(),
                    content: answer.trim().to_owned(),
                    tags: std::iter::once(call.question.as_str())
                        .chain(interview_responses.iter().flat_map(|response| {
                            [response.prompt.as_str(), response.answer.as_str()]
                        }))
                        .flat_map(str::split_whitespace)
                        .take(12)
                        .map(|term| term.trim_matches(|c: char| !c.is_alphanumeric()).to_owned())
                        .filter(|term| !term.is_empty())
                        .collect(),
                    price_krw: call.unit_price,
                    age_days: 0,
                    quality_score: quality::quality_score(&call.question, answer),
                    reliability_score: reliability,
                    locked: false,
                    demographics: Some(DemographicBands {
                        age_band: profile.age_band.clone(),
                        region: profile.region.clone(),
                        household: profile.household.clone(),
                        field: profile.field.clone(),
                    }),
                };
            insert_document(&transaction, &document, created_at)?;
            if call.escrow_remaining_krw < call.unit_price {
                return Err(StoreError::Conflict(
                    "open-call escrow is exhausted".to_owned(),
                ));
            }
            if let Some((_, payout_atomic)) = &onchain_payout {
                let changed = transaction.execute(
                    "UPDATE open_calls SET answered = answered + 1,
                        escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                        escrow_remaining_atomic = escrow_remaining_atomic - ?1,
                        status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
                     WHERE id = ?2 AND status = 'open' AND answered < target
                       AND escrow_remaining_atomic >= ?1",
                    params![as_i64(*payout_atomic)?, open_call_id],
                )?;
                if changed == 0 {
                    return Err(StoreError::Conflict(
                        "open-call on-chain escrow is exhausted".to_owned(),
                    ));
                }
            } else {
                transaction.execute(
                    "UPDATE open_calls SET answered = answered + 1,
                        escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                        status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
                     WHERE id = ?1",
                    [open_call_id],
                )?;
                let changed = transaction.execute(
                    "UPDATE balances SET reserved_krw = reserved_krw - ?1, updated_at = ?2
                     WHERE user_id = ?3 AND reserved_krw >= ?1",
                    params![as_i64(call.unit_price)?, as_i64(created_at)?, call.owner_id],
                )?;
                if changed == 0 && call.unit_price > 0 {
                    return Err(StoreError::Conflict(
                        "reserved balance is inconsistent with this call".to_owned(),
                    ));
                }
            }
        }

        transaction.execute(
            "INSERT INTO memory_entries
             (id, user_id, open_call_id, document_id, question, answer, shelf,
              earned_krw, created_at, via, status, flags_json, interview_json,
              memory_type, importance, content_hash, reliability_score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Open call', ?10, ?11, ?12,
                     'observation', ?13, ?14, ?15)",
            params![
                memory_id,
                user_id,
                open_call_id,
                document_id,
                call.question,
                answer.trim(),
                call.shelf,
                as_i64(if voided { 0 } else { call.unit_price })?,
                as_i64(created_at)?,
                if voided { "voided" } else { "settled" },
                serde_json::to_string(&issues).expect("issues are serialisable"),
                serde_json::to_string(&interview_responses)
                    .expect("interview responses are serialisable"),
                importance,
                content_hash,
                reliability,
            ],
        )?;
        if !voided {
            reliability = author_reliability(&transaction, user_id)?;
            transaction.execute(
                "UPDATE memory_entries SET reliability_score = ?1 WHERE id = ?2",
                params![reliability, memory_id],
            )?;
            transaction.execute(
                "UPDATE documents SET reliability_score = ?1 WHERE author_id = ?2",
                params![reliability, user_id],
            )?;
            maybe_create_reflection(&transaction, user_id, created_at, reliability)?;
            if let Some((recipient_wallet, payout_atomic)) = &onchain_payout {
                let earning_id = insert_open_call_onchain_earning_event(
                    &transaction,
                    Some(&memory_id),
                    document_id.as_deref(),
                    user_id,
                    call.unit_price,
                    recipient_wallet,
                    created_at,
                )?;
                insert_payout_claim(
                    &transaction,
                    Some(&earning_id),
                    Some(open_call_id),
                    user_id,
                    "open_call_answer",
                    call.escrow_wallet.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow wallet".to_owned())
                    })?,
                    recipient_wallet,
                    call.escrow_asset.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow asset".to_owned())
                    })?,
                    call.escrow_network.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow network".to_owned())
                    })?,
                    *payout_atomic,
                    call.unit_price,
                    created_at,
                )?;
            } else {
                insert_earning_event(
                    &transaction,
                    None,
                    Some(&memory_id),
                    document_id.as_deref(),
                    user_id,
                    "open_call",
                    call.unit_price,
                    created_at,
                )?;
            }
            insert_notification(
                &transaction,
                &call.owner_id,
                "answer_received",
                "A new answer arrived",
                &format!(
                    "{}/{} answers collected for {}",
                    call.answered + 1,
                    call.target,
                    call.question
                ),
                Some(open_call_id),
            )?;
            if call.answered + 1 >= call.target {
                insert_notification(
                    &transaction,
                    &call.owner_id,
                    "call_filled",
                    "Your open call is complete",
                    &format!("All {} answers are ready to read.", call.target),
                    Some(open_call_id),
                )?;
                transaction.execute(
                    "DELETE FROM open_call_reservations WHERE open_call_id = ?1",
                    [open_call_id],
                )?;
            }
        }
        transaction.execute(
            "DELETE FROM open_call_reservations WHERE open_call_id = ?1 AND user_id = ?2",
            params![open_call_id, user_id],
        )?;

        let updated_call = StoredCall {
            answered: call.answered + usize::from(!voided),
            escrow_remaining_krw: call.escrow_remaining_krw.saturating_sub(if voided {
                0
            } else {
                call.unit_price
            }),
            escrow_remaining_atomic: call.escrow_remaining_atomic.map(|remaining| {
                remaining.saturating_sub(
                    onchain_payout
                        .as_ref()
                        .filter(|_| !voided)
                        .map_or(0, |(_, amount)| *amount),
                )
            }),
            status: if !voided && call.answered + 1 >= call.target {
                "filled".to_owned()
            } else {
                call.status.clone()
            },
            ..call
        };
        let memory = MemoryEntry {
            id: memory_id,
            question: updated_call.question.clone(),
            answer: answer.trim().to_owned(),
            shelf: updated_call.shelf.clone(),
            earned: if voided { 0 } else { updated_call.unit_price },
            created_at,
            via: "Open call".to_owned(),
            status: if voided { "voided" } else { "settled" }.to_owned(),
            flags: issues.clone(),
            rating: None,
            dispute_status: None,
            interview_responses,
            memory_type: "observation".to_owned(),
            importance,
            reliability_score: reliability,
            content_hash,
            version: 1,
            locked: false,
            access_count: 0,
            last_accessed_at: None,
            source_ids: Vec::new(),
        };
        transaction.commit()?;

        Ok(SubmitAnswerResponse {
            order: updated_call.public(Some(user_id), Some(&profile)),
            memory,
            issues,
        })
    }

    pub fn list_memory(&self, user_id: &str) -> Result<Vec<MemoryEntry>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, question, answer, shelf, earned_krw, created_at, via,
                    status, flags_json, rating,
                    (SELECT status FROM dispute_events d WHERE d.memory_id = memory_entries.id),
                    interview_json, memory_type, importance, reliability_score, content_hash,
                    version, locked, access_count, last_accessed_at, source_ids_json
             FROM memory_entries WHERE user_id = ?1 ORDER BY created_at DESC",
        )?;
        let entries = statement
            .query_map([user_id], memory_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn set_memory_locked(
        &self,
        user_id: &str,
        memory_id: &str,
        locked: bool,
    ) -> Result<MemoryEntry, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let document_id = transaction
            .query_row(
                "SELECT document_id FROM memory_entries WHERE id = ?1 AND user_id = ?2",
                params![memory_id.trim(), user_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("memory"))?;
        transaction.execute(
            "UPDATE memory_entries SET locked = ?1 WHERE id = ?2 AND user_id = ?3",
            params![i64::from(locked), memory_id.trim(), user_id],
        )?;
        if let Some(document_id) = document_id {
            transaction.execute(
                "UPDATE documents SET locked = ?1 WHERE id = ?2",
                params![i64::from(locked), document_id],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.list_memory(user_id)?
            .into_iter()
            .find(|memory| memory.id == memory_id.trim())
            .ok_or(StoreError::NotFound("memory"))
    }

    pub fn correct_memory(
        &self,
        user_id: &str,
        memory_id: &str,
        request: &CorrectMemoryRequest,
    ) -> Result<MemoryEntry, StoreError> {
        if request.answer.trim().is_empty() || request.answer.chars().count() > 10_000 {
            return Err(StoreError::Validation(
                "corrected answer must contain 1 to 10000 characters".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (question, shelf, old_document_id, old_version, interview_json) = transaction
            .query_row(
                "SELECT question, shelf, document_id, version, interview_json
                 FROM memory_entries
                 WHERE id = ?1 AND user_id = ?2 AND status = 'settled'",
                params![memory_id.trim(), user_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        as_u64(row.get(3)?)?.min(u32::MAX as u64) as u32,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("settled memory"))?;
        let issues = quality::assess(&question, &request.answer);
        if !issues.is_empty() {
            return Err(StoreError::Validation(format!(
                "corrected answer failed quality checks: {}",
                issues[0].detail
            )));
        }
        let Some(old_document_id) = old_document_id else {
            return Err(StoreError::Conflict(
                "reflection memories cannot be corrected as paid passages".to_owned(),
            ));
        };
        let (category, price_krw, author_id, prior_quality, reliability_score) = transaction
            .query_row(
                "SELECT category, price_krw, author_id, quality_score, reliability_score
                 FROM documents WHERE id = ?1",
                [&old_document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        as_u64(row.get(1)?)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, f32>(3)?,
                        row.get::<_, f32>(4)?,
                    ))
                },
            )?;
        let demographics = load_profile(&transaction, user_id)?.map(|profile| DemographicBands {
            age_band: profile.age_band,
            region: profile.region,
            household: profile.household,
            field: profile.field,
        });
        let created_at = now_ms();
        let new_document_id = new_id("md");
        let new_memory_id = new_id("memory");
        let version = old_version.saturating_add(1);
        let document = Document {
            id: new_document_id.clone(),
            handle: handle_from_id(&new_document_id),
            author_id,
            shelf_id: slug(&shelf),
            shelf: shelf.clone(),
            category,
            content: request.answer.trim().to_owned(),
            tags: question
                .split_whitespace()
                .take(20)
                .map(ToOwned::to_owned)
                .collect(),
            price_krw,
            age_days: 0,
            quality_score: prior_quality.max(quality::quality_score(&question, &request.answer)),
            reliability_score,
            locked: false,
            demographics,
        };
        insert_document(&transaction, &document, created_at)?;
        transaction.execute(
            "UPDATE documents SET version = ?1 WHERE id = ?2",
            params![version as i64, new_document_id],
        )?;
        transaction.execute(
            "UPDATE documents SET locked = 1 WHERE id = ?1",
            [&old_document_id],
        )?;
        transaction.execute(
            "UPDATE memory_entries SET locked = 1 WHERE id = ?1",
            [memory_id.trim()],
        )?;
        let hash = sha256_hex(request.answer.trim());
        transaction.execute(
            "INSERT INTO memory_entries
             (id, user_id, document_id, question, answer, shelf, earned_krw, created_at,
              via, status, flags_json, interview_json, memory_type, importance,
              source_ids_json, content_hash, version, reliability_score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'Correction', 'settled', '[]', ?8,
                     'correction', 0.9, ?9, ?10, ?11, ?12)",
            params![
                new_memory_id,
                user_id,
                new_document_id,
                question,
                request.answer.trim(),
                shelf,
                as_i64(created_at)?,
                interview_json,
                serde_json::to_string(&[memory_id.trim()]).expect("source is serialisable"),
                hash,
                version as i64,
                reliability_score,
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        self.list_memory(user_id)?
            .into_iter()
            .find(|memory| memory.id == new_memory_id)
            .ok_or(StoreError::NotFound("corrected memory"))
    }

    pub fn export_account(&self, user_id: &str) -> Result<MemoryExport, StoreError> {
        let connection = self.connection()?;
        let access_log = {
            let mut statement = connection.prepare(
                "SELECT id, memory_id, purpose, created_at FROM memory_access_events
                 WHERE memory_id IN (SELECT id FROM memory_entries WHERE user_id = ?1)
                 ORDER BY created_at DESC",
            )?;
            statement
                .query_map([user_id], |row| {
                    Ok(MemoryAccessEvent {
                        id: row.get(0)?,
                        memory_id: row.get(1)?,
                        purpose: row.get(2)?,
                        created_at: as_u64(row.get(3)?)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        drop(connection);
        Ok(MemoryExport {
            exported_at: now_ms(),
            profile: self.get_profile(user_id)?,
            memories: self.list_memory(user_id)?,
            access_log,
        })
    }

    pub fn contributor_manifest(&self, handle: &str) -> Result<ContributorManifest, StoreError> {
        let connection = self.connection()?;
        let (user_id, demographics, updated_at) = connection
            .query_row(
                "SELECT p.user_id, p.age_band, p.region, p.household, p.field, p.updated_at
                 FROM profiles p JOIN users u ON u.id = p.user_id
                 WHERE p.handle = ?1 COLLATE NOCASE AND p.auto_match = 1
                   AND u.deleted_at IS NULL",
                [handle.trim()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        DemographicBands {
                            age_band: row.get(1)?,
                            region: row.get(2)?,
                            household: row.get(3)?,
                            field: row.get(4)?,
                        },
                        as_u64(row.get(5)?)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("contributor"))?;
        let reliability = author_reliability_readonly(&connection, &user_id)?;
        let safe_handle = handle.trim().to_owned();
        let memories = {
            let mut statement = connection.prepare(
                "SELECT m.id, d.handle, m.content_hash, m.version, m.memory_type,
                        m.importance, m.created_at
                 FROM memory_entries m JOIN documents d ON d.id = m.document_id
                 WHERE m.user_id = ?1 AND m.status = 'settled' AND m.locked = 0 AND d.locked = 0
                 ORDER BY m.importance DESC, m.created_at DESC LIMIT 100",
            )?;
            statement
                .query_map([&user_id], |row| {
                    let id: String = row.get(0)?;
                    let document_handle: String = row.get(1)?;
                    Ok(ContributorMemoryLink {
                        canonical_url: format!("/api/v1/documents/{document_handle}"),
                        x402_template: "/api/v1/paid-documents/{queryId}/{documentHandle}"
                            .to_owned(),
                        id,
                        content_hash: row.get(2)?,
                        version: as_u64(row.get(3)?)?.min(u32::MAX as u64) as u32,
                        memory_type: row.get(4)?,
                        importance: row.get(5)?,
                        updated_at: as_u64(row.get(6)?)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(ContributorManifest {
            schema: "https://openshelf.dev/schemas/contributor-manifest/v1",
            canonical_url: format!("/api/v1/contributors/{safe_handle}"),
            handle: safe_handle,
            demographics,
            reliability_score: reliability,
            memory_count: memories.len(),
            updated_at,
            memories,
        })
    }

    pub fn public_document(&self, handle: &str) -> Result<PublicDocument, StoreError> {
        self.connection()?
            .query_row(
                "SELECT d.handle, p.handle, d.shelf, d.category, d.content_hash,
                        d.version, d.price_krw
                 FROM documents d
                 LEFT JOIN profiles p ON p.user_id = d.author_id
                 WHERE d.handle = ?1 AND d.locked = 0 AND COALESCE(p.auto_match, 1) = 1",
                [handle.trim()],
                |row| {
                    let document_handle = row.get::<_, String>(0)?;
                    Ok(PublicDocument {
                        schema: "https://openshelf.dev/schemas/paid-document/v1",
                        canonical_url: format!("/api/v1/documents/{document_handle}"),
                        handle: document_handle,
                        contributor_handle: row.get(1)?,
                        shelf: row.get(2)?,
                        category: row.get(3)?,
                        content_hash: row.get(4)?,
                        version: as_u64(row.get(5)?)?.min(u32::MAX as u64) as u32,
                        price_krw: as_u64(row.get(6)?)?,
                        x402_template: "/api/v1/paid-documents/{queryId}/{documentHandle}"
                            .to_owned(),
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("public document"))
    }

    pub fn account_controls(&self, user_id: &str) -> Result<AccountControls, StoreError> {
        let connection = self.connection()?;
        let strikes = connection.query_row(
            "SELECT COUNT(*) FROM memory_entries WHERE user_id = ?1 AND status = 'voided'",
            [user_id],
            |row| as_usize(row.get(0)?),
        )?;
        let dispute_used = connection
            .query_row(
                "SELECT 1 FROM dispute_events WHERE user_id = ?1",
                [user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        Ok(AccountControls {
            strikes,
            dispute_used,
            suspended: strikes >= STRIKE_LIMIT,
        })
    }

    pub fn get_profile(&self, user_id: &str) -> Result<Option<UserProfile>, StoreError> {
        if user_id.trim().is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        let connection = self.connection()?;
        load_profile(&connection, user_id.trim())
    }

    pub fn upsert_profile(
        &self,
        user_id: &str,
        request: &UpsertProfileRequest,
    ) -> Result<UserProfile, StoreError> {
        validate_profile(request)?;
        let user_id = user_id.trim();
        let handle = request.handle.trim().to_uppercase();
        let wallet = request
            .wallet
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let now = now_ms();
        {
            let mut connection = self.connection()?;
            let transaction = connection.transaction()?;
            let conflicting_user = transaction
                .query_row(
                    "SELECT user_id FROM profiles
                     WHERE handle = ?1 COLLATE NOCASE AND user_id <> ?2",
                    params![handle, user_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if conflicting_user.is_some() {
                return Err(StoreError::Conflict(
                    "this anonymous handle is already in use".to_owned(),
                ));
            }
            transaction.execute(
                "INSERT INTO profiles
                 (user_id, handle, age_band, region, household, field, years,
                  speaks_to_json, wallet, wallet_verified_at, agreed_at, consent_version,
                  auto_match, agents, browser_alerts, email_alerts,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, ?13, ?14, ?15, ?10, ?10)
                 ON CONFLICT(user_id) DO UPDATE SET
                   handle = excluded.handle,
                   age_band = excluded.age_band,
                   region = excluded.region,
                   household = excluded.household,
                   field = excluded.field,
                   years = excluded.years,
                   speaks_to_json = excluded.speaks_to_json,
                   wallet = excluded.wallet,
                   wallet_verified_at = CASE
                     WHEN profiles.wallet = excluded.wallet THEN profiles.wallet_verified_at
                     ELSE NULL
                   END,
                   consent_version = excluded.consent_version,
                   auto_match = excluded.auto_match,
                   agents = excluded.agents,
                   browser_alerts = excluded.browser_alerts,
                   email_alerts = excluded.email_alerts,
                   updated_at = excluded.updated_at",
                params![
                    user_id,
                    handle,
                    request.age_band.trim(),
                    request.region.trim(),
                    request.household.trim(),
                    request.field.trim(),
                    request.years.trim(),
                    serde_json::to_string(&request.speaks_to)
                        .expect("profile categories are serialisable"),
                    wallet,
                    as_i64(now)?,
                    CURRENT_CONSENT_VERSION,
                    i64::from(request.auto_match),
                    i64::from(request.agents),
                    i64::from(request.browser_alerts),
                    i64::from(request.email_alerts),
                ],
            )?;
            materialize_call_notifications(&transaction, user_id)?;
            transaction.commit()?;
        }
        self.get_profile(user_id)?
            .ok_or(StoreError::NotFound("profile"))
    }

    pub fn update_preferences(
        &self,
        user_id: &str,
        request: &UpdatePreferencesRequest,
    ) -> Result<UserProfile, StoreError> {
        let user_id = user_id.trim();
        if user_id.is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        if request.auto_match.is_none()
            && request.agents.is_none()
            && request.browser_alerts.is_none()
            && request.email_alerts.is_none()
        {
            return Err(StoreError::Validation(
                "at least one preference is required".to_owned(),
            ));
        }
        let changed = self.connection()?.execute(
            "UPDATE profiles
             SET auto_match = COALESCE(?1, auto_match),
                 agents = COALESCE(?2, agents),
                 browser_alerts = COALESCE(?3, browser_alerts),
                 email_alerts = COALESCE(?4, email_alerts),
                 updated_at = ?5
             WHERE user_id = ?6",
            params![
                request.auto_match.map(i64::from),
                request.agents.map(i64::from),
                request.browser_alerts.map(i64::from),
                request.email_alerts.map(i64::from),
                as_i64(now_ms())?,
                user_id,
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound("profile"));
        }
        self.get_profile(user_id)?
            .ok_or(StoreError::NotFound("profile"))
    }

    pub fn create_wallet_challenge(
        &self,
        user_id: &str,
        wallet: &str,
        nonce: &str,
        ttl_ms: u64,
    ) -> Result<WalletChallenge, StoreError> {
        let user_id = user_id.trim();
        let wallet = wallet.trim();
        let nonce = nonce.trim();
        if user_id.is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        if !valid_solana_address(wallet) {
            return Err(StoreError::Validation(
                "wallet must be a base58 Solana public key".to_owned(),
            ));
        }
        if nonce.len() != 64 || !nonce.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err(StoreError::Validation(
                "wallet challenge nonce must be 32 bytes of hex".to_owned(),
            ));
        }
        if !(60_000..=10 * 60_000).contains(&ttl_ms) {
            return Err(StoreError::Validation(
                "wallet challenge ttl must be between one and ten minutes".to_owned(),
            ));
        }

        let now = now_ms();
        let expires_at = now.saturating_add(ttl_ms);
        let id = new_id("wallet_challenge");
        let message = format!(
            "OPENSHELF wallet verification\nAccount: {user_id}\nWallet: {wallet}\nNonce: {nonce}\nExpires: {expires_at}"
        );
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let has_profile = transaction
            .query_row(
                "SELECT 1 FROM profiles WHERE user_id = ?1",
                [user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !has_profile {
            return Err(StoreError::Conflict(
                "complete onboarding before verifying a wallet".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE wallet_challenges SET consumed_at = ?1
             WHERE user_id = ?2 AND consumed_at IS NULL",
            params![as_i64(now)?, user_id],
        )?;
        transaction.execute(
            "DELETE FROM wallet_challenges WHERE expires_at < ?1",
            [as_i64(now.saturating_sub(24 * 60 * 60 * 1_000))?],
        )?;
        transaction.execute(
            "INSERT INTO wallet_challenges
             (id, user_id, wallet, message, expires_at, consumed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![
                id,
                user_id,
                wallet,
                message,
                as_i64(expires_at)?,
                as_i64(now)?,
            ],
        )?;
        transaction.commit()?;
        Ok(WalletChallenge {
            id,
            wallet: wallet.to_owned(),
            message,
            expires_at,
        })
    }

    pub fn verify_wallet_challenge(
        &self,
        user_id: &str,
        challenge_id: &str,
        signature: &str,
    ) -> Result<UserProfile, StoreError> {
        let user_id = user_id.trim();
        let challenge_id = challenge_id.trim();
        let signature = signature.trim();
        if user_id.is_empty() || challenge_id.is_empty() {
            return Err(StoreError::Validation(
                "user id and challengeId are required".to_owned(),
            ));
        }

        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (wallet, message, expires_at, consumed_at) = transaction
            .query_row(
                "SELECT wallet, message, expires_at, consumed_at
                 FROM wallet_challenges WHERE id = ?1 AND user_id = ?2",
                params![challenge_id, user_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        as_u64(row.get(2)?)?,
                        row.get::<_, Option<i64>>(3)?.map(as_u64).transpose()?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("wallet challenge"))?;
        if consumed_at.is_some() {
            return Err(StoreError::Conflict(
                "this wallet challenge has already been used".to_owned(),
            ));
        }
        if expires_at < now {
            return Err(StoreError::Conflict(
                "this wallet challenge has expired".to_owned(),
            ));
        }

        let public_key = bs58::decode(&wallet)
            .into_vec()
            .map_err(|_| StoreError::Validation("wallet is not valid base58".to_owned()))?;
        let public_key: [u8; 32] = public_key
            .try_into()
            .map_err(|_| StoreError::Validation("wallet must decode to 32 bytes".to_owned()))?;
        let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| {
            StoreError::Validation("wallet is not a valid Ed25519 public key".to_owned())
        })?;
        let signature = bs58::decode(signature)
            .into_vec()
            .map_err(|_| StoreError::Unauthorized("wallet signature is invalid".to_owned()))?;
        let signature = Signature::from_slice(&signature)
            .map_err(|_| StoreError::Unauthorized("wallet signature is invalid".to_owned()))?;
        verifying_key
            .verify_strict(message.as_bytes(), &signature)
            .map_err(|_| StoreError::Unauthorized("wallet signature is invalid".to_owned()))?;

        let owner = transaction
            .query_row(
                "SELECT user_id FROM profiles
                 WHERE wallet = ?1 AND wallet_verified_at IS NOT NULL AND user_id <> ?2",
                params![wallet, user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if owner.is_some() {
            return Err(StoreError::Conflict(
                "this wallet is already verified by another account".to_owned(),
            ));
        }
        let changed = transaction.execute(
            "UPDATE profiles SET wallet = ?1, wallet_verified_at = ?2, updated_at = ?2
             WHERE user_id = ?3",
            params![wallet, as_i64(now)?, user_id],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound("profile"));
        }
        transaction.execute(
            "UPDATE wallet_challenges SET consumed_at = ?1
             WHERE id = ?2 AND consumed_at IS NULL",
            params![as_i64(now)?, challenge_id],
        )?;
        transaction.execute(
            "UPDATE prepaid_wallet_sessions SET revoked_at = ?1
             WHERE user_id = ?2 AND revoked_at IS NULL",
            params![as_i64(now)?, user_id],
        )?;
        transaction.commit()?;
        drop(connection);
        self.get_profile(user_id)?
            .ok_or(StoreError::NotFound("profile"))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_wallet_siwx_challenge(
        &self,
        user_id: &str,
        challenge_id: &str,
        domain: &str,
        uri: &str,
        statement: &str,
        nonce: &str,
        issued_at: &str,
        expiration_time: &str,
        network: &str,
        ttl_ms: u64,
    ) -> Result<WalletSiwxChallengeRecord, StoreError> {
        let user_id = user_id.trim();
        let challenge_id = challenge_id.trim();
        let domain = domain.trim();
        let uri = uri.trim();
        let statement = statement.trim();
        let nonce = nonce.trim();
        let issued_at = issued_at.trim();
        let expiration_time = expiration_time.trim();
        let network = network.trim();
        if user_id.is_empty()
            || domain.is_empty()
            || uri.is_empty()
            || statement.is_empty()
            || issued_at.is_empty()
            || expiration_time.is_empty()
            || network.is_empty()
        {
            return Err(StoreError::Validation(
                "complete SIWX challenge metadata is required".to_owned(),
            ));
        }
        if challenge_id.len() != 64
            || nonce.len() != 64
            || !challenge_id
                .chars()
                .chain(nonce.chars())
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(StoreError::Validation(
                "SIWX challenge id and nonce must each be 32 bytes of hex".to_owned(),
            ));
        }
        if domain.len() > 253
            || domain
                .chars()
                .any(|character| character.is_whitespace() || matches!(character, '/' | '\\'))
            || !(uri.starts_with("https://")
                || uri.starts_with("http://127.0.0.1:")
                || uri.starts_with("http://localhost:"))
        {
            return Err(StoreError::Validation(
                "SIWX domain or resource URI is invalid".to_owned(),
            ));
        }
        if !(60_000..=10 * 60_000).contains(&ttl_ms) {
            return Err(StoreError::Validation(
                "SIWX challenge ttl must be between one and ten minutes".to_owned(),
            ));
        }

        let now = now_ms();
        let expires_at = now.saturating_add(ttl_ms);
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let has_profile = transaction
            .query_row(
                "SELECT 1 FROM profiles WHERE user_id = ?1",
                [user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !has_profile {
            return Err(StoreError::Conflict(
                "complete onboarding before verifying a wallet".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE wallet_siwx_challenges SET consumed_at = ?1
             WHERE user_id = ?2 AND consumed_at IS NULL",
            params![as_i64(now)?, user_id],
        )?;
        transaction.execute(
            "DELETE FROM wallet_siwx_challenges WHERE expires_at < ?1",
            [as_i64(now.saturating_sub(24 * 60 * 60 * 1_000))?],
        )?;
        transaction.execute(
            "INSERT INTO wallet_siwx_challenges
             (id, user_id, domain, uri, statement, nonce, issued_at,
              expiration_time, network, expires_at, consumed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
            params![
                challenge_id,
                user_id,
                domain,
                uri,
                statement,
                nonce,
                issued_at,
                expiration_time,
                network,
                as_i64(expires_at)?,
                as_i64(now)?,
            ],
        )?;
        transaction.commit()?;
        Ok(WalletSiwxChallengeRecord {
            id: challenge_id.to_owned(),
            user_id: user_id.to_owned(),
            domain: domain.to_owned(),
            uri: uri.to_owned(),
            statement: statement.to_owned(),
            nonce: nonce.to_owned(),
            issued_at: issued_at.to_owned(),
            expiration_time: expiration_time.to_owned(),
            network: network.to_owned(),
            expires_at,
            consumed_at: None,
        })
    }

    pub fn wallet_siwx_challenge(
        &self,
        challenge_id: &str,
    ) -> Result<WalletSiwxChallengeRecord, StoreError> {
        self.connection()?
            .query_row(
                "SELECT id, user_id, domain, uri, statement, nonce, issued_at,
                        expiration_time, network, expires_at, consumed_at
                 FROM wallet_siwx_challenges WHERE id = ?1",
                [challenge_id.trim()],
                wallet_siwx_challenge_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("wallet SIWX challenge"))
    }

    pub fn verify_wallet_siwx_challenge(
        &self,
        challenge_id: &str,
        payload: &SiwxPayload,
    ) -> Result<UserProfile, StoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let challenge = transaction
            .query_row(
                "SELECT id, user_id, domain, uri, statement, nonce, issued_at,
                        expiration_time, network, expires_at, consumed_at
                 FROM wallet_siwx_challenges WHERE id = ?1",
                [challenge_id.trim()],
                wallet_siwx_challenge_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("wallet SIWX challenge"))?;
        if challenge.consumed_at.is_some() {
            return Err(StoreError::Conflict(
                "this wallet SIWX challenge has already been used".to_owned(),
            ));
        }
        if challenge.expires_at <= now {
            return Err(StoreError::Conflict(
                "this wallet SIWX challenge has expired".to_owned(),
            ));
        }
        let resources_match = payload
            .resources
            .as_deref()
            .is_some_and(|resources| resources.len() == 1 && resources[0] == challenge.uri);
        if payload.domain != challenge.domain
            || payload.uri != challenge.uri
            || payload.statement.as_deref() != Some(challenge.statement.as_str())
            || payload.version != "1"
            || payload.chain_id != challenge.network
            || payload.nonce != challenge.nonce
            || payload.issued_at != challenge.issued_at
            || payload.expiration_time.as_deref() != Some(challenge.expiration_time.as_str())
            || payload.not_before.is_some()
            || payload.request_id.as_deref() != Some(challenge.id.as_str())
            || !resources_match
            || payload.signature_type != "ed25519"
            || payload.signature_scheme.as_deref().unwrap_or("siws") != "siws"
        {
            return Err(StoreError::Unauthorized(
                "wallet SIWX payload does not match its challenge".to_owned(),
            ));
        }
        let public_key = bs58::decode(payload.address.trim())
            .into_vec()
            .map_err(|_| StoreError::Unauthorized("wallet SIWX address is invalid".to_owned()))?;
        let public_key: [u8; 32] = public_key
            .try_into()
            .map_err(|_| StoreError::Unauthorized("wallet SIWX address is invalid".to_owned()))?;
        let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| {
            StoreError::Unauthorized("wallet SIWX address is not an Ed25519 key".to_owned())
        })?;
        let signature = bs58::decode(payload.signature.trim())
            .into_vec()
            .map_err(|_| StoreError::Unauthorized("wallet SIWX signature is invalid".to_owned()))?;
        let signature = Signature::from_slice(&signature)
            .map_err(|_| StoreError::Unauthorized("wallet SIWX signature is invalid".to_owned()))?;
        verifying_key
            .verify_strict(siwx_message(payload)?.as_bytes(), &signature)
            .map_err(|_| StoreError::Unauthorized("wallet SIWX signature is invalid".to_owned()))?;

        let owner = transaction
            .query_row(
                "SELECT user_id FROM profiles
                 WHERE wallet = ?1 AND wallet_verified_at IS NOT NULL AND user_id <> ?2",
                params![payload.address.trim(), challenge.user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if owner.is_some() {
            return Err(StoreError::Conflict(
                "this wallet is already verified by another account".to_owned(),
            ));
        }
        let changed = transaction.execute(
            "UPDATE profiles SET wallet = ?1, wallet_verified_at = ?2, updated_at = ?2
             WHERE user_id = ?3",
            params![payload.address.trim(), as_i64(now)?, challenge.user_id],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound("profile"));
        }
        let consumed = transaction.execute(
            "UPDATE wallet_siwx_challenges SET consumed_at = ?1
             WHERE id = ?2 AND consumed_at IS NULL",
            params![as_i64(now)?, challenge.id],
        )?;
        if consumed != 1 {
            return Err(StoreError::Conflict(
                "this wallet SIWX challenge has already been used".to_owned(),
            ));
        }
        transaction.commit()?;
        drop(connection);
        self.get_profile(&challenge.user_id)?
            .ok_or(StoreError::NotFound("profile"))
    }

    pub fn earnings(&self, user_id: &str) -> Result<EarningsSummary, StoreError> {
        if user_id.trim().is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        self.release_matured_holds(user_id.trim())?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT e.id, e.settlement_id, e.memory_id, d.handle, e.source,
                    e.amount_krw, e.recipient_wallet, e.payout_status,
                    e.available_at, e.created_at, pc.id, pc.status,
                    pc.transaction_signature, pc.amount_atomic
             FROM earning_events e
             LEFT JOIN documents d ON d.id = e.document_id
             LEFT JOIN payout_claims pc ON pc.earning_event_id = e.id
             WHERE e.author_id = ?1
             ORDER BY e.created_at DESC, e.id DESC",
        )?;
        let events = statement
            .query_map([user_id.trim()], earning_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let accrued_krw = events
            .iter()
            .fold(0_u64, |sum, event| sum.saturating_add(event.amount_krw));
        let held_krw = events
            .iter()
            .filter(|event| event.payout_status == "held")
            .fold(0_u64, |sum, event| sum.saturating_add(event.amount_krw));
        let available_krw = events
            .iter()
            .filter(|event| event.payout_status == "accrued")
            .fold(0_u64, |sum, event| sum.saturating_add(event.amount_krw));
        let claimable_krw = events
            .iter()
            .filter(|event| event.payout_status == "claimable")
            .fold(0_u64, |sum, event| sum.saturating_add(event.amount_krw));
        Ok(EarningsSummary {
            accrued_krw,
            held_krw,
            available_krw,
            claimable_krw,
            event_count: events.len(),
            events,
        })
    }

    pub fn payout_claims(&self, user_id: &str) -> Result<Vec<PayoutClaim>, StoreError> {
        if user_id.trim().is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, earning_event_id, open_call_id, beneficiary_user_id, kind,
                    escrow_wallet, recipient_wallet, asset, network, amount_atomic,
                    amount_krw, status, transaction_signature, NULL, recent_blockhash,
                    last_valid_block_height, attempt_count, last_error, created_at,
                    updated_at, confirmed_at
             FROM payout_claims WHERE beneficiary_user_id = ?1
             ORDER BY created_at DESC, id DESC",
        )?;
        statement
            .query_map([user_id.trim()], payout_claim_from_row)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn lease_payout_claims(
        &self,
        worker_id: &str,
        escrow_wallet: &str,
        network: &str,
        limit: usize,
        lease_ms: u64,
    ) -> Result<Vec<PayoutClaim>, StoreError> {
        let worker_id = worker_id.trim();
        if !(3..=128).contains(&worker_id.len()) {
            return Err(StoreError::Validation(
                "workerId must be between 3 and 128 characters".to_owned(),
            ));
        }
        if !(1..=100).contains(&limit) || !(10_000..=600_000).contains(&lease_ms) {
            return Err(StoreError::Validation(
                "payout lease requires limit 1..100 and leaseMs 10000..600000".to_owned(),
            ));
        }
        if !valid_solana_address(escrow_wallet.trim()) || network.trim().is_empty() {
            return Err(StoreError::Validation(
                "a valid escrowWallet and network are required for payout leasing".to_owned(),
            ));
        }
        let now = now_ms();
        let lease_expires_at = now.saturating_add(lease_ms);
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE payout_claims
             SET status = CASE WHEN signed_transaction_base64 IS NULL THEN 'pending' ELSE 'prepared' END,
                 lease_owner = NULL, lease_expires_at = NULL, updated_at = ?1
             WHERE status = 'leased' AND lease_expires_at <= ?1",
            [as_i64(now)?],
        )?;
        let ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM payout_claims
                 WHERE confirmed_at IS NULL AND attempt_count < 10
                   AND escrow_wallet = ?2 AND network = ?3
                   AND status IN ('pending', 'failed', 'prepared')
                   AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
                 ORDER BY CASE status WHEN 'prepared' THEN 0 ELSE 1 END, created_at, id
                 LIMIT ?4",
            )?;
            statement
                .query_map(
                    params![
                        as_i64(now)?,
                        escrow_wallet.trim(),
                        network.trim(),
                        limit as i64
                    ],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut claims = Vec::with_capacity(ids.len());
        for id in ids {
            transaction.execute(
                "UPDATE payout_claims
                 SET status = CASE WHEN signed_transaction_base64 IS NULL THEN 'leased' ELSE 'prepared' END,
                     lease_owner = ?1, lease_expires_at = ?2, updated_at = ?3
                 WHERE id = ?4",
                params![
                    worker_id,
                    as_i64(lease_expires_at)?,
                    as_i64(now)?,
                    id,
                ],
            )?;
            claims.push(load_payout_claim(&transaction, &id)?);
        }
        transaction.commit()?;
        Ok(claims)
    }

    pub fn prepare_payout_claim(
        &self,
        claim_id: &str,
        worker_id: &str,
        transaction_signature: &str,
        signed_transaction_base64: &str,
        recent_blockhash: &str,
        last_valid_block_height: u64,
    ) -> Result<PayoutClaim, StoreError> {
        let transaction_signature = transaction_signature.trim();
        let signed_transaction_base64 = signed_transaction_base64.trim();
        if !bs58::decode(transaction_signature)
            .into_vec()
            .is_ok_and(|decoded| decoded.len() == 64)
        {
            return Err(StoreError::Validation(
                "transactionSignature must be a base58 Solana signature".to_owned(),
            ));
        }
        if !(32..=32_768).contains(&signed_transaction_base64.len())
            || !signed_transaction_base64
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '/' | '='))
        {
            return Err(StoreError::Validation(
                "signedTransactionBase64 must be a bounded base64 transaction".to_owned(),
            ));
        }
        if !valid_solana_address(recent_blockhash) || last_valid_block_height == 0 {
            return Err(StoreError::Validation(
                "recentBlockhash and lastValidBlockHeight are required".to_owned(),
            ));
        }
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (status, lease_owner, lease_expires_at, existing_signature, existing_raw) = transaction
            .query_row(
                "SELECT status, lease_owner, lease_expires_at, transaction_signature,
                        signed_transaction_base64
                 FROM payout_claims WHERE id = ?1",
                [claim_id.trim()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?.map(as_u64).transpose()?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payout claim"))?;
        require_active_payout_lease(worker_id, lease_owner.as_deref(), lease_expires_at, now)?;
        if status == "prepared" {
            if existing_signature.as_deref() == Some(transaction_signature)
                && existing_raw.as_deref() == Some(signed_transaction_base64)
            {
                return load_payout_claim(&transaction, claim_id.trim());
            }
            return Err(StoreError::Conflict(
                "payout claim already has a different prepared transaction".to_owned(),
            ));
        }
        if status != "leased" {
            return Err(StoreError::Conflict(
                "payout claim must be leased before preparation".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE payout_claims
             SET status = 'prepared', transaction_signature = ?1,
                 signed_transaction_base64 = ?2, recent_blockhash = ?3,
                 last_valid_block_height = ?4, attempt_count = attempt_count + 1,
                 last_error = NULL, updated_at = ?5
             WHERE id = ?6",
            params![
                transaction_signature,
                signed_transaction_base64,
                recent_blockhash.trim(),
                as_i64(last_valid_block_height)?,
                as_i64(now)?,
                claim_id.trim(),
            ],
        )?;
        let claim = load_payout_claim(&transaction, claim_id.trim())?;
        transaction.commit()?;
        Ok(claim)
    }

    pub fn complete_payout_claim(
        &self,
        claim_id: &str,
        worker_id: &str,
        transaction_signature: &str,
    ) -> Result<PayoutClaim, StoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let claim = load_payout_claim(&transaction, claim_id.trim())?;
        if claim.status == "confirmed" {
            if claim.transaction_signature.as_deref() == Some(transaction_signature.trim()) {
                return Ok(claim);
            }
            return Err(StoreError::Conflict(
                "payout claim was confirmed with another signature".to_owned(),
            ));
        }
        let (lease_owner, lease_expires_at) = transaction.query_row(
            "SELECT lease_owner, lease_expires_at FROM payout_claims WHERE id = ?1",
            [claim_id.trim()],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<i64>>(1)?.map(as_u64).transpose()?,
                ))
            },
        )?;
        require_active_payout_lease(worker_id, lease_owner.as_deref(), lease_expires_at, now)?;
        if claim.status != "prepared"
            || claim.transaction_signature.as_deref() != Some(transaction_signature.trim())
        {
            return Err(StoreError::Conflict(
                "confirmed signature does not match the prepared payout".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE payout_claims
             SET status = 'confirmed', signed_transaction_base64 = NULL,
                 lease_owner = NULL, lease_expires_at = NULL, last_error = NULL,
                 confirmed_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![as_i64(now)?, claim_id.trim()],
        )?;
        if let Some(earning_event_id) = claim.earning_event_id.as_deref() {
            transaction.execute(
                "UPDATE earning_events SET payout_status = 'paid' WHERE id = ?1",
                [earning_event_id],
            )?;
        }
        let completed = load_payout_claim(&transaction, claim_id.trim())?;
        transaction.commit()?;
        Ok(completed)
    }

    pub fn fail_payout_claim(
        &self,
        claim_id: &str,
        worker_id: &str,
        error: &str,
        abandon_prepared_transaction: bool,
    ) -> Result<PayoutClaim, StoreError> {
        let error = error.trim();
        if error.is_empty() || error.chars().count() > 1_000 {
            return Err(StoreError::Validation(
                "payout failure error must be between 1 and 1000 characters".to_owned(),
            ));
        }
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let claim = load_payout_claim(&transaction, claim_id.trim())?;
        let (lease_owner, lease_expires_at) = transaction.query_row(
            "SELECT lease_owner, lease_expires_at FROM payout_claims WHERE id = ?1",
            [claim_id.trim()],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<i64>>(1)?.map(as_u64).transpose()?,
                ))
            },
        )?;
        require_active_payout_lease(worker_id, lease_owner.as_deref(), lease_expires_at, now)?;
        if claim.status == "confirmed" {
            return Ok(claim);
        }
        if abandon_prepared_transaction {
            transaction.execute(
                "UPDATE payout_claims
                 SET status = 'failed', transaction_signature = NULL,
                     signed_transaction_base64 = NULL, recent_blockhash = NULL,
                     last_valid_block_height = NULL, lease_owner = NULL,
                     lease_expires_at = NULL, last_error = ?1, updated_at = ?2
                 WHERE id = ?3",
                params![error, as_i64(now)?, claim_id.trim()],
            )?;
        } else {
            transaction.execute(
                "UPDATE payout_claims
                 SET status = CASE WHEN signed_transaction_base64 IS NULL THEN 'failed' ELSE 'prepared' END,
                     lease_owner = NULL, lease_expires_at = NULL,
                     last_error = ?1, updated_at = ?2 WHERE id = ?3",
                params![error, as_i64(now)?, claim_id.trim()],
            )?;
        }
        let failed = load_payout_claim(&transaction, claim_id.trim())?;
        transaction.commit()?;
        Ok(failed)
    }

    pub fn submit_dispute(
        &self,
        memory_id: &str,
        user_id: &str,
        reason: &str,
    ) -> Result<DisputeCase, StoreError> {
        let reason = reason.trim();
        if !(20..=1_000).contains(&reason.chars().count()) {
            return Err(StoreError::Validation(
                "dispute reason must be between 20 and 1000 characters".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let dispute_used = transaction
            .query_row(
                "SELECT 1 FROM dispute_events WHERE user_id = ?1",
                [user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if dispute_used {
            return Err(StoreError::Conflict(
                "this account has already used its dispute".to_owned(),
            ));
        }
        let memory_status = transaction
            .query_row(
                "SELECT status FROM memory_entries WHERE id = ?1 AND user_id = ?2",
                params![memory_id, user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("memory entry"))?;
        if memory_status != "voided" {
            return Err(StoreError::Conflict(
                "only a voided answer can be disputed".to_owned(),
            ));
        }
        let created_at = now_ms();
        transaction.execute(
            "INSERT INTO dispute_events
             (user_id, memory_id, reason, status, created_at)
             VALUES (?1, ?2, ?3, 'pending', ?4)",
            params![user_id, memory_id, reason, as_i64(created_at)?],
        )?;
        transaction.commit()?;
        Ok(DisputeCase {
            memory_id: memory_id.to_owned(),
            user_id: user_id.to_owned(),
            status: "pending".to_owned(),
            reason: reason.to_owned(),
            review_note: None,
            created_at,
            reviewed_at: None,
        })
    }

    pub fn list_disputes(&self, reviewer_id: &str) -> Result<Vec<DisputeCase>, StoreError> {
        self.require_admin(reviewer_id)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT memory_id, user_id, status, reason, review_note, created_at, reviewed_at
             FROM dispute_events ORDER BY created_at ASC",
        )?;
        Ok(statement
            .query_map(params![], dispute_from_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_evidence_edge(
        &self,
        reviewer_id: &str,
        request: &CreateEvidenceEdgeRequest,
    ) -> Result<EvidenceEdge, StoreError> {
        self.require_admin(reviewer_id)?;
        if ![
            "cites",
            "corroborates",
            "endorses",
            "verified_outcome",
            "contextualizes",
            "contradicts",
        ]
        .contains(&request.relation.as_str())
        {
            return Err(StoreError::Validation(
                "unsupported evidence relation".to_owned(),
            ));
        }
        if !["admin_verified", "outcome_verified"].contains(&request.provenance.as_str()) {
            return Err(StoreError::Validation(
                "admin ingestion requires verified provenance".to_owned(),
            ));
        }
        if request.topic.trim().is_empty()
            || request.topic.chars().count() > 64
            || !request.weight.is_finite()
            || !(0.0..=2.0).contains(&request.weight)
        {
            return Err(StoreError::Validation(
                "topic and weight must be valid".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (source_id, source_author) = transaction
            .query_row(
                "SELECT id, author_id FROM documents WHERE handle = ?1 AND locked = 0",
                [request.source_handle.trim()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("source document"))?;
        let (target_id, target_author) = transaction
            .query_row(
                "SELECT id, author_id FROM documents WHERE handle = ?1 AND locked = 0",
                [request.target_handle.trim()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("target document"))?;
        if source_id == target_id || source_author == target_author {
            return Err(StoreError::Conflict(
                "authority edges require independently owned documents".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO evidence_edges
             (id, source_document_id, target_document_id, relation, provenance,
              topic, weight, actor, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                new_id("edge"),
                source_id,
                target_id,
                request.relation,
                request.provenance,
                request.topic.trim(),
                request.weight,
                reviewer_id,
                as_i64(now_ms())?,
            ],
        )?;
        transaction.commit()?;
        Ok(EvidenceEdge {
            source_document_id: source_id,
            target_document_id: target_id,
            relation: request.relation.clone(),
            provenance: request.provenance.clone(),
            topic: request.topic.trim().to_owned(),
            weight: request.weight,
        })
    }

    pub fn my_dispute(&self, user_id: &str) -> Result<Option<DisputeCase>, StoreError> {
        Ok(self
            .connection()?
            .query_row(
                "SELECT memory_id, user_id, status, reason, review_note, created_at, reviewed_at
                 FROM dispute_events WHERE user_id = ?1",
                [user_id],
                dispute_from_row,
            )
            .optional()?)
    }

    pub fn review_dispute(
        &self,
        reviewer_id: &str,
        memory_id: &str,
        request: &ReviewDisputeRequest,
    ) -> Result<DisputeCase, StoreError> {
        self.require_admin(reviewer_id)?;
        if !["approved", "rejected"].contains(&request.decision.as_str()) {
            return Err(StoreError::Validation(
                "decision must be approved or rejected".to_owned(),
            ));
        }
        let note = request.note.trim();
        if !(5..=1_000).contains(&note.chars().count()) {
            return Err(StoreError::Validation(
                "review note must be between 5 and 1000 characters".to_owned(),
            ));
        }
        let reviewed_at = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let dispute = transaction
            .query_row(
                "SELECT memory_id, user_id, status, reason, review_note, created_at, reviewed_at
                 FROM dispute_events WHERE memory_id = ?1",
                [memory_id],
                dispute_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("dispute"))?;
        if dispute.status != "pending" {
            return Err(StoreError::Conflict(
                "this dispute has already been reviewed".to_owned(),
            ));
        }

        if request.decision == "approved" {
            let (memory, call_id, category, price, owner_id) = transaction
                .query_row(
                    "SELECT m.id, m.question, m.answer, m.shelf, m.earned_krw,
                            m.created_at, m.via, m.status, m.flags_json, m.rating,
                            (SELECT status FROM dispute_events d WHERE d.memory_id = m.id),
                            m.interview_json, m.memory_type, m.importance,
                            m.reliability_score, m.content_hash, m.version, m.locked,
                            m.access_count, m.last_accessed_at, m.source_ids_json,
                            m.open_call_id, c.category, c.unit_price_krw, c.owner_id
                     FROM memory_entries m
                     JOIN open_calls c ON c.id = m.open_call_id
                     WHERE m.id = ?1 AND m.user_id = ?2",
                    params![memory_id, dispute.user_id],
                    |row| {
                        Ok((
                            memory_from_row(row)?,
                            row.get::<_, String>(21)?,
                            row.get::<_, String>(22)?,
                            as_u64(row.get(23)?)?,
                            row.get::<_, String>(24)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(StoreError::NotFound("memory entry"))?;
            let call = load_call(&transaction, &call_id)?;
            if memory.status != "voided" || call.answered >= call.target {
                return Err(StoreError::Conflict(
                    "the original answer can no longer fill this call".to_owned(),
                ));
            }
            if call.escrow_remaining_krw < price {
                return Err(StoreError::Conflict(
                    "the original call no longer has enough escrow".to_owned(),
                ));
            }
            let profile = load_profile(&transaction, &dispute.user_id)?
                .ok_or(StoreError::NotFound("profile"))?;
            let document_id = new_id("md");
            let document = Document {
                id: document_id.clone(),
                handle: handle_from_id(&document_id),
                author_id: dispute.user_id.clone(),
                shelf_id: slug(&memory.shelf),
                shelf: memory.shelf.clone(),
                category,
                content: memory.answer.clone(),
                tags: memory
                    .question
                    .split_whitespace()
                    .take(12)
                    .map(ToOwned::to_owned)
                    .collect(),
                price_krw: price,
                age_days: 0,
                quality_score: 0.7,
                reliability_score: 0.65,
                locked: false,
                demographics: Some(DemographicBands {
                    age_band: profile.age_band,
                    region: profile.region,
                    household: profile.household,
                    field: profile.field,
                }),
            };
            insert_document(&transaction, &document, memory.created_at)?;
            transaction.execute(
                "UPDATE memory_entries SET status = 'settled', document_id = ?1, earned_krw = ?2
                 WHERE id = ?3",
                params![document_id, as_i64(price)?, memory_id],
            )?;
            transaction.execute(
                "UPDATE open_calls SET answered = answered + 1,
                    escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                    status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
                 WHERE id = ?1",
                [call_id.as_str()],
            )?;
            transaction.execute(
                "UPDATE balances SET reserved_krw = reserved_krw - ?1, updated_at = ?2
                 WHERE user_id = ?3 AND reserved_krw >= ?1",
                params![as_i64(price)?, as_i64(reviewed_at)?, owner_id],
            )?;
            insert_earning_event(
                &transaction,
                None,
                Some(memory_id),
                Some(&document_id),
                &dispute.user_id,
                "dispute_restored",
                price,
                reviewed_at,
            )?;
        }
        transaction.execute(
            "UPDATE dispute_events
             SET status = ?1, reviewer_id = ?2, review_note = ?3, reviewed_at = ?4
             WHERE memory_id = ?5",
            params![
                request.decision,
                reviewer_id,
                note,
                as_i64(reviewed_at)?,
                memory_id
            ],
        )?;
        transaction.commit()?;
        Ok(DisputeCase {
            status: request.decision.clone(),
            review_note: Some(note.to_owned()),
            reviewed_at: Some(reviewed_at),
            ..dispute
        })
    }

    pub fn list_document_feedback(
        &self,
        reviewer_id: &str,
    ) -> Result<Vec<DocumentFeedback>, StoreError> {
        self.require_admin(reviewer_id)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, query_id, document_handle, payer, outcome, reason, status,
                    review_note, created_at, reviewed_at
             FROM document_feedback
             ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at ASC",
        )?;
        Ok(statement
            .query_map(params![], document_feedback_from_row)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn review_document_feedback(
        &self,
        reviewer_id: &str,
        feedback_id: &str,
        request: &ReviewDocumentFeedbackRequest,
    ) -> Result<DocumentFeedback, StoreError> {
        self.require_admin(reviewer_id)?;
        if !["upheld", "dismissed"].contains(&request.decision.as_str()) {
            return Err(StoreError::Validation(
                "decision must be upheld or dismissed".to_owned(),
            ));
        }
        let note = request.note.trim();
        if !(5..=1_000).contains(&note.chars().count()) {
            return Err(StoreError::Validation(
                "review note must be between 5 and 1000 characters".to_owned(),
            ));
        }

        let reviewed_at = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let feedback = transaction
            .query_row(
                "SELECT id, query_id, document_handle, payer, outcome, reason, status,
                        review_note, created_at, reviewed_at
                 FROM document_feedback WHERE id = ?1",
                [feedback_id.trim()],
                document_feedback_from_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("document feedback"))?;
        if feedback.outcome != "report" || feedback.status != "pending" {
            return Err(StoreError::Conflict(
                "only a pending report can be reviewed".to_owned(),
            ));
        }
        let document_id = transaction.query_row(
            "SELECT document_id FROM document_feedback WHERE id = ?1",
            [feedback_id.trim()],
            |row| row.get::<_, String>(0),
        )?;
        transaction.execute(
            "UPDATE document_feedback
             SET status = ?1, reviewer_id = ?2, review_note = ?3, reviewed_at = ?4
             WHERE id = ?5 AND status = 'pending'",
            params![
                request.decision,
                reviewer_id,
                note,
                as_i64(reviewed_at)?,
                feedback_id.trim(),
            ],
        )?;
        recompute_document_reliability(&transaction, &document_id)?;
        transaction.commit()?;
        Ok(DocumentFeedback {
            status: request.decision.clone(),
            review_note: Some(note.to_owned()),
            reviewed_at: Some(reviewed_at),
            ..feedback
        })
    }

    fn require_admin(&self, user_id: &str) -> Result<(), StoreError> {
        let role = self
            .connection()?
            .query_row(
                "SELECT role FROM users WHERE id = ?1 AND deleted_at IS NULL",
                [user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if role.as_deref() != Some("admin") {
            return Err(StoreError::Unauthorized(
                "administrator access is required".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn ai_liquidity_metrics(&self, user_id: &str) -> Result<AiLiquidityMetrics, StoreError> {
        self.require_admin(user_id)?;
        let connection = self.connection()?;
        let (total_queries, ai_only, hybrid, human_covered) = connection.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN liquidity_state = 'ai_liquidity_only' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN liquidity_state = 'hybrid_coverage' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN liquidity_state = 'human_covered' THEN 1 ELSE 0 END)
             FROM queries",
            params![],
            |row| {
                Ok((
                    as_u64(row.get(0)?)?,
                    as_u64(row.get::<_, Option<i64>>(1)?.unwrap_or(0))?,
                    as_u64(row.get::<_, Option<i64>>(2)?.unwrap_or(0))?,
                    as_u64(row.get::<_, Option<i64>>(3)?.unwrap_or(0))?,
                ))
            },
        )?;
        let (baselines_generated, active_baselines) = connection.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN expires_at > ?1 THEN 1 ELSE 0 END)
             FROM ai_baselines",
            [as_i64(now_ms())?],
            |row| {
                Ok((
                    as_u64(row.get(0)?)?,
                    as_u64(row.get::<_, Option<i64>>(1)?.unwrap_or(0))?,
                ))
            },
        )?;
        let (shelf_starters_generated, shelf_starters_answered) = connection.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END)
             FROM shelf_starters",
            params![],
            |row| {
                Ok((
                    as_u64(row.get(0)?)?,
                    as_u64(row.get::<_, Option<i64>>(1)?.unwrap_or(0))?,
                ))
            },
        )?;
        let human_documents =
            connection.query_row("SELECT COUNT(*) FROM documents", params![], |row| {
                as_u64(row.get(0)?)
            })?;
        let open_human_calls = connection.query_row(
            "SELECT COUNT(*) FROM open_calls WHERE status = 'open' AND answered < target",
            params![],
            |row| as_u64(row.get(0)?),
        )?;
        let ai_authority_edges = connection.query_row(
            "SELECT COUNT(*) FROM evidence_edges
             WHERE actor LIKE 'ai:%' OR provenance = 'ai_generated'",
            params![],
            |row| as_u64(row.get(0)?),
        )?;
        Ok(AiLiquidityMetrics {
            total_queries,
            ai_liquidity_only_queries: ai_only,
            hybrid_coverage_queries: hybrid,
            human_covered_queries: human_covered,
            baselines_generated,
            active_baselines,
            shelf_starters_generated,
            shelf_starters_answered,
            human_documents,
            open_human_calls,
            // AI artifacts have no insertion path into `documents`; exposing
            // this invariant as a metric makes a future regression visible.
            priced_ai_documents: 0,
            ai_authority_edges,
            starter_to_human_document_rate: if shelf_starters_generated == 0 {
                0.0
            } else {
                shelf_starters_answered as f64 / shelf_starters_generated as f64
            },
        })
    }

    pub fn cancel_open_call(
        &self,
        user_id: &str,
        open_call_id: &str,
    ) -> Result<OpenCall, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let mut call = load_call(&transaction, open_call_id)?;
        if call.owner_id != user_id {
            return Err(StoreError::NotFound("open call"));
        }
        if call.status != "open" {
            return Err(StoreError::Conflict(
                "only an open call can be cancelled".to_owned(),
            ));
        }
        let refund = call.escrow_remaining_krw;
        let now = now_ms();
        if call.escrow_mode == "x402_solana_escrow" {
            let refund_atomic = call.escrow_remaining_atomic.unwrap_or(0);
            if refund_atomic > 0 {
                insert_payout_claim(
                    &transaction,
                    None,
                    Some(open_call_id),
                    user_id,
                    "open_call_refund",
                    call.escrow_wallet.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow wallet".to_owned())
                    })?,
                    call.payer_wallet.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no payer wallet".to_owned())
                    })?,
                    call.escrow_asset.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow asset".to_owned())
                    })?,
                    call.escrow_network.as_deref().ok_or_else(|| {
                        StoreError::Conflict("funded call has no escrow network".to_owned())
                    })?,
                    refund_atomic,
                    refund,
                    now,
                )?;
            }
        } else {
            let changed = transaction.execute(
                "UPDATE balances
                 SET available_krw = available_krw + ?1,
                     reserved_krw = reserved_krw - ?1,
                     updated_at = ?2
                 WHERE user_id = ?3 AND reserved_krw >= ?1",
                params![as_i64(refund)?, as_i64(now)?, user_id],
            )?;
            if changed == 0 && refund > 0 {
                return Err(StoreError::Conflict(
                    "reserved balance is inconsistent with this call".to_owned(),
                ));
            }
        }
        transaction.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0,
                    escrow_remaining_atomic = CASE
                        WHEN escrow_remaining_atomic IS NULL THEN NULL ELSE 0 END
             WHERE id = ?1",
            [open_call_id],
        )?;
        transaction.execute(
            "DELETE FROM open_call_reservations WHERE open_call_id = ?1",
            [open_call_id],
        )?;
        transaction.execute(
            "UPDATE contributor_notifications SET read_at = COALESCE(read_at, ?1)
             WHERE open_call_id = ?2 AND kind = 'call_available'",
            params![as_i64(now)?, open_call_id],
        )?;
        transaction.execute(
            "INSERT INTO funding_events
             (id, user_id, open_call_id, kind, amount_krw, created_at)
             VALUES (?1, ?2, ?3, 'open_call_refunded', ?4, ?5)",
            params![
                new_id("fund"),
                user_id,
                open_call_id,
                as_i64(refund)?,
                as_i64(now)?
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        call.status = "cancelled".to_owned();
        call.escrow_remaining_krw = 0;
        call.escrow_remaining_atomic = call.escrow_remaining_atomic.map(|_| 0);
        let profile = self.get_profile(user_id)?;
        Ok(call.public(Some(user_id), profile.as_ref()))
    }

    pub fn chat_answers(
        &self,
        user_id: &str,
        chat_id: &str,
    ) -> Result<Vec<ChatAnswer>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT m.id, m.open_call_id, COALESCE(p.handle, d.handle), m.shelf, m.answer, m.earned_krw,
                    m.created_at, p.age_band, p.region, p.household, p.field
             FROM memory_entries m
             JOIN open_calls c ON c.id = m.open_call_id
             JOIN documents d ON d.id = m.document_id
             LEFT JOIN profiles p ON p.user_id = m.user_id
             WHERE c.owner_id = ?1 AND c.chat_id = ?2 AND m.status = 'settled'
             ORDER BY m.created_at ASC",
        )?;
        Ok(statement
            .query_map(params![user_id, chat_id], |row| {
                let age_band = row.get::<_, Option<String>>(7)?;
                let region = row.get::<_, Option<String>>(8)?;
                let household = row.get::<_, Option<String>>(9)?;
                let field = row.get::<_, Option<String>>(10)?;
                Ok(ChatAnswer {
                    id: row.get(0)?,
                    open_call_id: row.get(1)?,
                    handle: row.get(2)?,
                    shelf: row.get(3)?,
                    excerpt: row.get(4)?,
                    price: as_u64(row.get(5)?)?,
                    created_at: as_u64(row.get(6)?)?,
                    demographics: age_band.map(|age_band| DemographicBands {
                        age_band,
                        region: region.unwrap_or_default(),
                        household: household.unwrap_or_default(),
                        field: field.unwrap_or_default(),
                    }),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn delete_account(&self, user_id: &str) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let exists = transaction
            .query_row(
                "SELECT 1 FROM users WHERE id = ?1 AND deleted_at IS NULL",
                [user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(StoreError::NotFound("user"));
        }
        let verified_wallet = transaction
            .query_row(
                "SELECT wallet FROM profiles
                 WHERE user_id = ?1 AND wallet_verified_at IS NOT NULL",
                [user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(wallet) = verified_wallet.as_deref() {
            let active_jobs = transaction.query_row(
                "SELECT COUNT(*) FROM payment_bundle_quotes
                 WHERE payer_wallet = ?1 AND funding_source = 'prepaid'
                   AND status IN ('funded', 'processing')",
                [wallet],
                |row| as_u64(row.get(0)?),
            )?;
            if active_jobs > 0 {
                return Err(StoreError::Conflict(
                    "wait for active prepaid research jobs before deleting the account".to_owned(),
                ));
            }
        }
        let refund = transaction.query_row(
            "SELECT COALESCE(CAST(SUM(escrow_remaining_krw) AS BIGINT), 0)
             FROM open_calls WHERE owner_id = ?1 AND status = 'open' AND escrow_mode = 'sandbox'",
            [user_id],
            |row| as_u64(row.get(0)?),
        )?;
        let onchain_refunds = {
            let mut statement = transaction.prepare(
                "SELECT id, escrow_remaining_krw, escrow_remaining_atomic, escrow_wallet,
                        payer_wallet, escrow_asset, escrow_network
                 FROM open_calls WHERE owner_id = ?1 AND status = 'open'
                   AND escrow_mode = 'x402_solana_escrow' AND escrow_remaining_atomic > 0",
            )?;
            statement
                .query_map([user_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        as_u64(row.get(1)?)?,
                        as_u64(row.get(2)?)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let now = now_ms();
        if let Some(wallet) = verified_wallet.as_deref() {
            #[allow(clippy::type_complexity)]
            let prepaid = {
                let mut statement = transaction.prepare(
                    "SELECT pay_to, network, asset, available_atomic
                     FROM prepaid_accounts WHERE wallet = ?1 AND available_atomic > 0",
                )?;
                statement
                    .query_map([wallet], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            as_u64(row.get(3)?)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?
            };
            for (pay_to, network, asset, amount_atomic) in prepaid {
                let claim_id = insert_payout_claim(
                    &transaction,
                    None,
                    None,
                    user_id,
                    "prepaid_account_deletion_withdrawal",
                    &pay_to,
                    wallet,
                    &asset,
                    &network,
                    amount_atomic,
                    0,
                    now,
                )?;
                transaction.execute(
                    "UPDATE prepaid_accounts SET available_atomic = 0, updated_at = ?1
                     WHERE wallet = ?2 AND pay_to = ?3 AND network = ?4 AND asset = ?5",
                    params![as_i64(now)?, wallet, pay_to, network, asset],
                )?;
                transaction.execute(
                    "INSERT INTO prepaid_ledger
                     (id, wallet, pay_to, network, asset, kind, reference_id,
                      delta_atomic, balance_after_atomic, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'account_deletion_withdrawal',
                             ?6, ?7, 0, ?8)",
                    params![
                        new_id("prepaid-ledger"),
                        wallet,
                        pay_to,
                        network,
                        asset,
                        claim_id,
                        -as_i64(amount_atomic)?,
                        as_i64(now)?,
                    ],
                )?;
            }
        }
        for (call_id, amount_krw, amount_atomic, escrow, payer, asset, network) in onchain_refunds {
            insert_payout_claim(
                &transaction,
                None,
                Some(&call_id),
                user_id,
                "open_call_account_deletion_refund",
                &escrow,
                &payer,
                &asset,
                &network,
                amount_atomic,
                amount_krw,
                now,
            )?;
        }
        transaction.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0,
                    escrow_remaining_atomic = CASE
                        WHEN escrow_remaining_atomic IS NULL THEN NULL ELSE 0 END
             WHERE owner_id = ?1 AND status = 'open'",
            [user_id],
        )?;
        if refund > 0 {
            transaction.execute(
                "UPDATE balances SET available_krw = available_krw + ?1,
                    reserved_krw = reserved_krw - ?1, updated_at = ?2
                 WHERE user_id = ?3 AND reserved_krw >= ?1",
                params![as_i64(refund)?, as_i64(now)?, user_id],
            )?;
        }

        let anonymous = format!("deleted:{}", new_id("account"));
        transaction.execute(
            "DELETE FROM query_matches WHERE document_handle IN
             (SELECT handle FROM documents WHERE author_id = ?1)",
            [user_id],
        )?;
        transaction.execute(
            "DELETE FROM evidence_edges
             WHERE source_document_id IN (SELECT id FROM documents WHERE author_id = ?1)
                OR target_document_id IN (SELECT id FROM documents WHERE author_id = ?1)",
            [user_id],
        )?;
        transaction.execute(
            "UPDATE earning_events SET memory_id = NULL, document_id = NULL,
                    author_id = ?1, recipient_wallet = NULL
             WHERE author_id = ?2",
            params![anonymous, user_id],
        )?;
        transaction.execute(
            "UPDATE memory_entries SET document_id = NULL WHERE user_id = ?1",
            [user_id],
        )?;
        transaction.execute("DELETE FROM documents WHERE author_id = ?1", [user_id])?;
        transaction.execute("DELETE FROM dispute_events WHERE user_id = ?1", [user_id])?;
        transaction.execute("DELETE FROM memory_entries WHERE user_id = ?1", [user_id])?;
        transaction.execute("DELETE FROM profiles WHERE user_id = ?1", [user_id])?;
        transaction.execute(
            "UPDATE open_calls SET owner_id = ?1, chat_id = NULL WHERE owner_id = ?2",
            params![anonymous, user_id],
        )?;
        transaction.execute(
            "UPDATE funding_events SET user_id = ?1 WHERE user_id = ?2",
            params![anonymous, user_id],
        )?;
        transaction.execute("DELETE FROM sessions WHERE user_id = ?1", [user_id])?;
        transaction.execute("DELETE FROM balances WHERE user_id = ?1", [user_id])?;
        transaction.execute("DELETE FROM users WHERE id = ?1", [user_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn payment_quote(
        &self,
        query_id: &str,
        handle: &str,
        policy: &PaymentQuotePolicy,
    ) -> Result<PaymentQuote, StoreError> {
        if policy.krw_per_usdc == 0 {
            return Err(StoreError::Validation(
                "krwPerUsdc must be greater than zero".to_owned(),
            ));
        }
        if !(30_000..=86_400_000).contains(&policy.ttl_ms) {
            return Err(StoreError::Validation(
                "payment quote ttl must be between 30 seconds and 24 hours".to_owned(),
            ));
        }
        if policy.network.trim().is_empty() || policy.asset.trim().is_empty() {
            return Err(StoreError::Validation(
                "payment network and asset are required".to_owned(),
            ));
        }

        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (
            document_id,
            document_handle,
            price_krw,
            author_id,
            profile_wallet,
            wallet_verified_at,
            content_snapshot,
            shelf_snapshot,
            content_hash,
            document_version,
            consent_version,
        ) = transaction
            .query_row(
                "SELECT d.id, d.handle, qm.quoted_price_krw, d.author_id,
                        p.wallet, p.wallet_verified_at, d.content, d.shelf,
                        d.content_hash, d.version, COALESCE(p.consent_version, 'seed.v1')
                 FROM query_matches qm
                 JOIN documents d ON d.handle = qm.document_handle
                 LEFT JOIN profiles p ON p.user_id = d.author_id
                 WHERE qm.query_id = ?1 AND qm.document_handle = ?2 AND d.locked = 0
                   AND COALESCE(p.auto_match, 1) = 1
                   AND (SELECT COUNT(*) FROM memory_entries strikes
                        WHERE strikes.user_id = d.author_id
                          AND strikes.status = 'voided') < ?3",
                params![
                    query_id.trim(),
                    handle.trim(),
                    AUTO_MATCH_STRIKE_LIMIT as i64
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        as_u64(row.get(2)?)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        as_u64(row.get(9)?)?.min(u32::MAX as u64) as u32,
                        row.get::<_, String>(10)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::DocumentNotQuoted)?;

        let pay_to = if wallet_verified_at.is_some() {
            profile_wallet.filter(|wallet| !wallet.trim().is_empty())
        } else if author_id.starts_with("author_") {
            policy.fallback_recipient.clone()
        } else {
            return Err(StoreError::Conflict(
                "this author must verify a payout wallet before the document can be purchased"
                    .to_owned(),
            ));
        }
        .ok_or_else(|| {
            StoreError::Conflict(
                "this document has no verified payout wallet; configure OPENSHELF_DEFAULT_RECEIVER only for seeded content"
                    .to_owned(),
            )
        })?;
        if !valid_solana_address(&pay_to) {
            return Err(StoreError::Validation(
                "payment recipient must be a base58 Solana public key".to_owned(),
            ));
        }

        let atomic = (u128::from(price_krw)
            .saturating_mul(USDC_ATOMIC_UNITS)
            .saturating_add(u128::from(policy.krw_per_usdc) - 1))
            / u128::from(policy.krw_per_usdc);
        let amount_atomic = u64::try_from(atomic.max(1)).map_err(|_| {
            StoreError::Validation("payment amount exceeds the supported range".to_owned())
        })?;

        let existing = transaction
            .query_row(
                "SELECT id, expires_at FROM payment_quotes
                 WHERE query_id = ?1 AND document_id = ?2 AND pay_to = ?3
                   AND network = ?4 AND asset = ?5 AND amount_atomic = ?6
                   AND price_krw = ?7 AND krw_per_usdc = ?8
                   AND expires_at > ?9 AND settled_at IS NULL
                   AND content_hash = ?10 AND document_version = ?11
                   AND consent_version = ?12
                 ORDER BY created_at DESC LIMIT 1",
                params![
                    query_id.trim(),
                    document_id,
                    pay_to,
                    policy.network.trim(),
                    policy.asset.trim(),
                    as_i64(amount_atomic)?,
                    as_i64(price_krw)?,
                    as_i64(policy.krw_per_usdc)?,
                    as_i64(now)?,
                    content_hash,
                    document_version as i64,
                    consent_version,
                ],
                |row| Ok((row.get::<_, String>(0)?, as_u64(row.get(1)?)?)),
            )
            .optional()?;
        let (id, expires_at) = if let Some(existing) = existing {
            existing
        } else {
            let id = new_id("quote");
            let expires_at = now.saturating_add(policy.ttl_ms);
            transaction.execute(
                "INSERT INTO payment_quotes
                 (id, query_id, document_id, document_handle, pay_to, network, asset,
                  amount_atomic, price_krw, krw_per_usdc, expires_at, created_at,
                  content_snapshot, shelf_snapshot, content_hash, document_version, status,
                  consent_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, ?16, 'quoted', ?17)",
                params![
                    id,
                    query_id.trim(),
                    document_id,
                    document_handle,
                    pay_to,
                    policy.network.trim(),
                    policy.asset.trim(),
                    as_i64(amount_atomic)?,
                    as_i64(price_krw)?,
                    as_i64(policy.krw_per_usdc)?,
                    as_i64(expires_at)?,
                    as_i64(now)?,
                    content_snapshot,
                    shelf_snapshot,
                    content_hash,
                    document_version as i64,
                    consent_version,
                ],
            )?;
            (id, expires_at)
        };
        transaction.commit()?;

        Ok(PaymentQuote {
            resource_path: format!(
                "/api/v1/paid-documents/{}/{}",
                query_id.trim(),
                document_handle
            ),
            canonical_url: format!("/api/v1/documents/{document_handle}"),
            id,
            query_id: query_id.trim().to_owned(),
            document_handle,
            pay_to,
            network: policy.network.trim().to_owned(),
            asset: policy.asset.trim().to_owned(),
            amount_atomic: amount_atomic.to_string(),
            price_krw,
            krw_per_usdc: policy.krw_per_usdc,
            expires_at,
            content_hash,
            document_version,
            status: "quoted".to_owned(),
            consent_version,
        })
    }

    /// Prepare one Pay.sh-native document URL without exposing passage text.
    ///
    /// The query capability proves that the caller owns the search result. The
    /// returned runtime recipient is public payment metadata, not profile data:
    /// user documents require a verified wallet and seed documents may use only
    /// the explicitly configured demo receiver.
    pub fn pay_sh_resource(
        &self,
        query_id: &str,
        handle: &str,
        payment_token_hash: &str,
        policy: &PaymentQuotePolicy,
    ) -> Result<PayShResource, StoreError> {
        {
            let connection = self.connection()?;
            require_query_access(&connection, query_id.trim(), payment_token_hash)?;
        }
        let quote = self.payment_quote(query_id, handle, policy)?;
        self.build_pay_sh_resource(&quote)
    }

    fn build_pay_sh_resource(&self, quote: &PaymentQuote) -> Result<PayShResource, StoreError> {
        if !PAY_SH_PRICE_BANDS_KRW.contains(&quote.price_krw) {
            return Err(StoreError::Conflict(
                "this document price is outside the Pay.sh hackathon price bands".to_owned(),
            ));
        }
        let amount_atomic = quote.amount_atomic.parse::<u64>().map_err(|_| {
            StoreError::Validation("Pay.sh quote amount is not a valid integer".to_owned())
        })?;
        if amount_atomic < 2 {
            return Err(StoreError::Validation(
                "Pay.sh direct split requires at least two atomic units".to_owned(),
            ));
        }
        let resource_path = format!(
            "/api/v1/pay-sh/documents/{}/{}/{}?owner_wallet={}&quote_id={}",
            quote.price_krw, quote.query_id, quote.document_handle, quote.pay_to, quote.id
        );
        let delivered = {
            let connection = self.connection()?;
            connection
                .query_row(
                    "SELECT 1 FROM settlements s
                     JOIN payment_quotes pq
                       ON s.transaction_signature = 'pay.sh:' || pq.id
                     WHERE s.query_id = ?1 AND s.payer = 'pay.sh'
                       AND s.mode = 'pay_sh_mpp_direct'
                       AND pq.document_handle = ?2 AND s.document_handles_json = ?3
                       AND pq.settled_at IS NOT NULL
                     LIMIT 1",
                    params![
                        quote.query_id,
                        quote.document_handle,
                        serde_json::to_string(&vec![quote.document_handle.clone()])
                            .expect("one document handle is serialisable")
                    ],
                    |_| Ok(()),
                )
                .optional()?
                .is_some()
        };
        Ok(PayShResource {
            quote_id: quote.id.clone(),
            query_id: quote.query_id.clone(),
            document_handle: quote.document_handle.clone(),
            recipient_wallet: quote.pay_to.clone(),
            network: quote.network.clone(),
            asset: quote.asset.clone(),
            amount_atomic: amount_atomic.to_string(),
            owner_amount_atomic: amount_atomic.saturating_sub(1).to_string(),
            platform_amount_atomic: "1".to_owned(),
            price_krw: quote.price_krw,
            krw_per_usdc: quote.krw_per_usdc,
            expires_at: quote.expires_at,
            status: if delivered { "delivered" } else { "quoted" }.to_owned(),
            resource_path,
            recovery_path: format!(
                "/api/v1/questions/{}/pay-sh-documents/{}",
                quote.query_id, quote.document_handle
            ),
            protocol: "mpp-charge".to_owned(),
        })
    }

    /// Release exactly one quoted document after the official Pay.sh proxy has
    /// verified its MPP charge. The path price and runtime split recipient are
    /// re-derived from the server-side quote so tampering can never reveal data.
    pub fn open_pay_sh_document(
        &self,
        request: PayShDeliveryRequest<'_>,
    ) -> Result<OpenDocumentsResponse, StoreError> {
        let PayShDeliveryRequest {
            query_id,
            handle,
            path_price_krw,
            owner_wallet,
            quote_id,
            payment_token_hash,
            research_job_id,
            policy,
        } = request;
        if policy.krw_per_usdc == 0 {
            return Err(StoreError::Validation(
                "krwPerUsdc must be greater than zero".to_owned(),
            ));
        }
        let connection = self.connection()?;
        if let Some(token_hash) = payment_token_hash {
            require_query_access(&connection, query_id.trim(), token_hash)?;
        } else if let Some(job_id) = research_job_id {
            let authorized = connection
                .query_row(
                    "SELECT 1
                     FROM payment_bundle_quotes pbq
                     JOIN payment_bundle_documents pbd ON pbd.quote_id = pbq.id
                     WHERE pbq.id = ?1 AND pbq.query_id = ?2
                       AND pbd.document_handle = ?3 AND pbd.pay_sh_quote_id = ?4
                       AND pbq.status IN ('funded', 'processing')
                     LIMIT 1",
                    params![
                        job_id.trim(),
                        query_id.trim(),
                        handle.trim(),
                        quote_id.trim()
                    ],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !authorized {
                return Err(StoreError::Conflict(
                    "Pay.sh resource is not bound to an active funded research job".to_owned(),
                ));
            }
        } else {
            return Err(StoreError::Unauthorized(
                "a query token or funded research job is required".to_owned(),
            ));
        }
        let quote = connection
            .query_row(
                "SELECT id, query_id, document_handle, pay_to, network, asset,
                        amount_atomic, price_krw, krw_per_usdc, expires_at,
                        content_hash, document_version, status, consent_version
                 FROM payment_quotes WHERE id = ?1",
                [quote_id.trim()],
                |row| {
                    let document_handle = row.get::<_, String>(2)?;
                    Ok(PaymentQuote {
                        id: row.get(0)?,
                        query_id: row.get(1)?,
                        resource_path: format!(
                            "/api/v1/paid-documents/{}/{}",
                            query_id.trim(),
                            document_handle
                        ),
                        canonical_url: format!("/api/v1/documents/{document_handle}"),
                        document_handle,
                        pay_to: row.get(3)?,
                        network: row.get(4)?,
                        asset: row.get(5)?,
                        amount_atomic: as_u64(row.get(6)?)?.to_string(),
                        price_krw: as_u64(row.get(7)?)?,
                        krw_per_usdc: as_u64(row.get(8)?)?,
                        expires_at: as_u64(row.get(9)?)?,
                        content_hash: row.get(10)?,
                        document_version: as_u64(row.get(11)?)?.min(u32::MAX as u64) as u32,
                        status: row.get(12)?,
                        consent_version: row.get(13)?,
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::DocumentNotQuoted)?;
        drop(connection);
        let resource = self.build_pay_sh_resource(&quote)?;
        if resource.price_krw != path_price_krw {
            return Err(StoreError::Validation(
                "Pay.sh resource price does not match the server quote".to_owned(),
            ));
        }
        if resource.recipient_wallet != owner_wallet.trim() {
            return Err(StoreError::Validation(
                "Pay.sh runtime recipient does not match the verified document owner".to_owned(),
            ));
        }
        if resource.quote_id != quote_id.trim() {
            return Err(StoreError::Validation(
                "Pay.sh quote id does not match the query-bound resource".to_owned(),
            ));
        }
        if resource.query_id != query_id.trim() || resource.document_handle != handle.trim() {
            return Err(StoreError::Validation(
                "Pay.sh quote is not bound to this query and document".to_owned(),
            ));
        }
        if resource.krw_per_usdc != policy.krw_per_usdc
            || resource.network != policy.network.trim()
            || resource.asset != policy.asset.trim()
        {
            return Err(StoreError::Conflict(
                "Pay.sh quote no longer matches the configured payment policy".to_owned(),
            ));
        }
        self.deliver_pay_sh_quote(&resource)
    }

    /// Recover a previously delivered Pay.sh document without another charge.
    pub fn recover_pay_sh_document(
        &self,
        query_id: &str,
        handle: &str,
        payment_token_hash: &str,
    ) -> Result<OpenDocumentsResponse, StoreError> {
        let connection = self.connection()?;
        require_query_access(&connection, query_id.trim(), payment_token_hash)?;
        let canonical_handles = serde_json::to_string(&vec![handle.trim().to_owned()])
            .expect("one document handle is serialisable");
        connection
            .query_row(
                "SELECT s.id, s.total_krw, pq.document_handle, pq.shelf_snapshot,
                        pq.content_snapshot, pq.price_krw, pq.network
                 FROM settlements s
                 JOIN payment_quotes pq
                   ON s.transaction_signature = 'pay.sh:' || pq.id
                 WHERE s.query_id = ?1 AND s.document_handles_json = ?3
                   AND s.payer = 'pay.sh' AND s.mode = 'pay_sh_mpp_direct'
                   AND pq.document_handle = ?2 AND pq.settled_at IS NOT NULL
                 ORDER BY s.created_at DESC LIMIT 1",
                params![query_id.trim(), handle.trim(), canonical_handles],
                |row| {
                    Ok(OpenDocumentsResponse {
                        settlement: Settlement {
                            id: row.get(0)?,
                            count: 1,
                            total: as_u64(row.get(1)?)?,
                            tx_sig: None,
                            network: Some(row.get(6)?),
                        },
                        citations: vec![Citation {
                            handle: row.get(2)?,
                            shelf: row.get(3)?,
                            excerpt: row.get(4)?,
                            price: as_u64(row.get(5)?)?,
                        }],
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("Pay.sh delivered document"))
    }

    fn deliver_pay_sh_quote(
        &self,
        resource: &PayShResource,
    ) -> Result<OpenDocumentsResponse, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let canonical_handles = serde_json::to_string(&vec![resource.document_handle.clone()])
            .expect("one document handle is serialisable");
        let existing = transaction
            .query_row(
                "SELECT id, total_krw, transaction_signature FROM settlements
                 WHERE query_id = ?1 AND document_handles_json = ?2
                   AND payer = 'pay.sh' AND mode = 'pay_sh_mpp_direct'",
                params![resource.query_id, canonical_handles],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        as_u64(row.get(1)?)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let effective_quote_id = existing
            .as_ref()
            .and_then(|(_, _, reference)| reference.strip_prefix("pay.sh:"))
            .unwrap_or(&resource.quote_id);
        let (document_id, author_id, memory_id, citation) = transaction
            .query_row(
                "SELECT pq.document_id, d.author_id,
                        (SELECT m.id FROM memory_entries m
                         WHERE m.document_id = pq.document_id AND m.status = 'settled' LIMIT 1),
                        pq.document_handle, pq.shelf_snapshot, pq.content_snapshot, pq.price_krw
                 FROM payment_quotes pq
                 JOIN documents d ON d.id = pq.document_id
                 WHERE pq.id = ?1 AND pq.query_id = ?2 AND pq.document_handle = ?3",
                params![
                    effective_quote_id,
                    resource.query_id,
                    resource.document_handle,
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        Citation {
                            handle: row.get(3)?,
                            shelf: row.get(4)?,
                            excerpt: row.get(5)?,
                            price: as_u64(row.get(6)?)?,
                        },
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::DocumentNotQuoted)?;

        let (settlement_id, total) = if let Some((id, total, _)) = existing {
            (id, total)
        } else {
            let created_at = now_ms();
            let settlement_id = new_id("settlement");
            transaction.execute(
                "INSERT INTO settlements
                 (id, query_id, payer, document_handles_json, total_krw, mode,
                  transaction_signature, created_at)
                 VALUES (?1, ?2, 'pay.sh', ?3, ?4, 'pay_sh_mpp_direct', ?5, ?6)",
                params![
                    settlement_id,
                    resource.query_id,
                    canonical_handles,
                    as_i64(citation.price)?,
                    format!("pay.sh:{}", resource.quote_id),
                    as_i64(created_at)?,
                ],
            )?;
            transaction.execute(
                "UPDATE payment_quotes SET settled_at = ?1, delivered_at = ?1,
                    status = 'delivered' WHERE id = ?2",
                params![as_i64(created_at)?, resource.quote_id],
            )?;
            transaction.execute(
                "UPDATE memory_entries SET earned_krw = earned_krw + ?1,
                    access_count = access_count + 1, last_accessed_at = ?2
                 WHERE document_id = ?3 AND status = 'settled'",
                params![as_i64(citation.price)?, as_i64(created_at)?, document_id],
            )?;
            transaction.execute(
                "INSERT INTO memory_access_events
                 (id, memory_id, document_id, quote_id, actor, purpose, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'pay.sh', 'pay_sh_paid_evidence', ?5)",
                params![
                    new_id("access"),
                    memory_id,
                    document_id,
                    resource.quote_id,
                    as_i64(created_at)?,
                ],
            )?;
            insert_onchain_earning_event(
                &transaction,
                &settlement_id,
                memory_id.as_deref(),
                &document_id,
                &author_id,
                citation.price,
                &resource.recipient_wallet,
                created_at,
            )?;
            (settlement_id, citation.price)
        };
        transaction.commit()?;
        Ok(OpenDocumentsResponse {
            citations: vec![citation],
            settlement: Settlement {
                id: settlement_id,
                count: 1,
                total,
                tx_sig: None,
                network: Some(resource.network.clone()),
            },
        })
    }

    /// Issues a revocable, expiring capability for spending only the verified
    /// wallet's OPENSHELF prepaid balance. It never grants token-account or
    /// Phantom authority.
    pub fn issue_prepaid_wallet_session(
        &self,
        user_id: &str,
        wallet: &str,
        session_token: &str,
        ttl_ms: u64,
        policy: &PaymentQuotePolicy,
    ) -> Result<PrepaidWalletSession, StoreError> {
        validate_payment_policy(policy)?;
        let pay_to = policy.bundle_recipient.as_deref().ok_or_else(|| {
            StoreError::Conflict("prepaid payments require OPENSHELF_BUNDLE_RECEIVER".to_owned())
        })?;
        let user_id = user_id.trim();
        let wallet = wallet.trim();
        if !valid_solana_address(wallet) || !valid_solana_address(pay_to) {
            return Err(StoreError::Validation(
                "prepaid wallet addresses must be valid Solana public keys".to_owned(),
            ));
        }
        if session_token.len() != 64
            || !session_token
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(StoreError::Validation(
                "prepaid session token must be 32 bytes of hex".to_owned(),
            ));
        }
        if !(60_000..=30 * 24 * 60 * 60 * 1_000).contains(&ttl_ms) {
            return Err(StoreError::Validation(
                "prepaid session ttl is outside the supported range".to_owned(),
            ));
        }
        let now = now_ms();
        let expires_at = now.saturating_add(ttl_ms);
        let token_hash = hex_digest(session_token.as_bytes());
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let verified = transaction
            .query_row(
                "SELECT 1 FROM profiles
                 WHERE user_id = ?1 AND wallet = ?2 AND wallet_verified_at IS NOT NULL",
                params![user_id, wallet],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !verified {
            return Err(StoreError::Unauthorized(
                "verify this Phantom wallet before enabling prepaid spending".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE prepaid_wallet_sessions SET revoked_at = ?1
             WHERE user_id = ?2 AND wallet = ?3 AND revoked_at IS NULL",
            params![as_i64(now)?, user_id, wallet],
        )?;
        transaction.execute(
            "INSERT INTO prepaid_wallet_sessions
             (id, user_id, wallet, token_hash, expires_at, revoked_at,
              last_used_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6)",
            params![
                new_id("prepaid-session"),
                user_id,
                wallet,
                token_hash,
                as_i64(expires_at)?,
                as_i64(now)?,
            ],
        )?;
        ensure_prepaid_account(
            &transaction,
            wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
            now,
        )?;
        let available_atomic = prepaid_available(
            &transaction,
            wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
        )?;
        transaction.commit()?;
        Ok(PrepaidWalletSession {
            token: session_token.to_owned(),
            wallet: wallet.to_owned(),
            pay_to: pay_to.to_owned(),
            network: policy.network.trim().to_owned(),
            asset: policy.asset.trim().to_owned(),
            available_atomic: available_atomic.to_string(),
            expires_at,
        })
    }

    pub fn prepaid_balance(
        &self,
        user_id: &str,
        policy: &PaymentQuotePolicy,
    ) -> Result<PrepaidBalance, StoreError> {
        validate_payment_policy(policy)?;
        let pay_to = policy.bundle_recipient.as_deref().ok_or_else(|| {
            StoreError::Conflict("prepaid payments require OPENSHELF_BUNDLE_RECEIVER".to_owned())
        })?;
        let connection = self.connection()?;
        let wallet = connection
            .query_row(
                "SELECT wallet FROM profiles
                 WHERE user_id = ?1 AND wallet_verified_at IS NOT NULL",
                [user_id.trim()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::Conflict(
                    "verify a Phantom wallet before reading prepaid balance".to_owned(),
                )
            })?;
        let available_atomic = prepaid_available(
            &connection,
            &wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
        )?;
        Ok(PrepaidBalance {
            wallet,
            pay_to: pay_to.to_owned(),
            network: policy.network.trim().to_owned(),
            asset: policy.asset.trim().to_owned(),
            available_atomic: available_atomic.to_string(),
        })
    }

    pub fn create_prepaid_withdrawal(
        &self,
        user_id: &str,
        requested_atomic: Option<&str>,
        policy: &PaymentQuotePolicy,
    ) -> Result<PayoutClaim, StoreError> {
        validate_payment_policy(policy)?;
        let pay_to = policy.bundle_recipient.as_deref().ok_or_else(|| {
            StoreError::Conflict("prepaid withdrawals require OPENSHELF_BUNDLE_RECEIVER".to_owned())
        })?;
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let wallet = transaction
            .query_row(
                "SELECT wallet FROM profiles
                 WHERE user_id = ?1 AND wallet_verified_at IS NOT NULL",
                [user_id.trim()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::Conflict("verify a Phantom wallet before withdrawing".to_owned())
            })?;
        let available = prepaid_available(
            &transaction,
            &wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
        )?;
        let amount_atomic = match requested_atomic {
            Some(value) => value.parse::<u64>().map_err(|_| {
                StoreError::Validation("amountAtomic must be an unsigned integer".to_owned())
            })?,
            None => available,
        };
        if amount_atomic == 0 || amount_atomic > available {
            return Err(StoreError::Conflict(
                "withdrawal must be positive and no greater than available prepaid balance"
                    .to_owned(),
            ));
        }
        let claim_id = insert_payout_claim(
            &transaction,
            None,
            None,
            user_id.trim(),
            "prepaid_withdrawal",
            pay_to,
            &wallet,
            policy.asset.trim(),
            policy.network.trim(),
            amount_atomic,
            amount_atomic
                .saturating_mul(policy.krw_per_usdc)
                .saturating_div(1_000_000),
            now,
        )?;
        let amount = as_i64(amount_atomic)?;
        let changed = transaction.execute(
            "UPDATE prepaid_accounts
             SET available_atomic = available_atomic - ?1, updated_at = ?2
             WHERE wallet = ?3 AND pay_to = ?4 AND network = ?5 AND asset = ?6
               AND available_atomic >= ?1",
            params![
                amount,
                as_i64(now)?,
                wallet,
                pay_to,
                policy.network.trim(),
                policy.asset.trim(),
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict(
                "prepaid balance changed before withdrawal could be reserved".to_owned(),
            ));
        }
        let balance = prepaid_available(
            &transaction,
            &wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
        )?;
        transaction.execute(
            "INSERT INTO prepaid_ledger
             (id, wallet, pay_to, network, asset, kind, reference_id,
              delta_atomic, balance_after_atomic, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'withdrawal_reservation', ?6, ?7, ?8, ?9)",
            params![
                new_id("prepaid-ledger"),
                wallet,
                pay_to,
                policy.network.trim(),
                policy.asset.trim(),
                claim_id,
                -amount,
                as_i64(balance)?,
                as_i64(now)?,
            ],
        )?;
        let claim = load_payout_claim(&transaction, &claim_id)?;
        transaction.commit()?;
        Ok(claim)
    }

    pub fn create_payment_bundle(
        &self,
        request: &CreatePaymentBundleRequest,
        payment_token_hash: &str,
        wallet_session_hash: &str,
        policy: &PaymentQuotePolicy,
    ) -> Result<PaymentBundleQuote, StoreError> {
        let query_id = request.query_id.trim();
        if request.handles.is_empty() || request.handles.len() > 100 {
            return Err(StoreError::Validation(
                "between 1 and 100 document handles are required".to_owned(),
            ));
        }
        let handles = request
            .handles
            .iter()
            .map(|handle| handle.trim().to_owned())
            .collect::<Vec<_>>();
        if handles.iter().any(String::is_empty)
            || handles.iter().collect::<HashSet<_>>().len() != handles.len()
        {
            return Err(StoreError::Validation(
                "document handles must be non-empty and unique".to_owned(),
            ));
        }
        validate_payment_policy(policy)?;
        let pay_to = policy.bundle_recipient.as_deref().ok_or_else(|| {
            StoreError::Conflict(
                "multi-document payment requires OPENSHELF_BUNDLE_RECEIVER".to_owned(),
            )
        })?;
        if !valid_solana_address(pay_to) {
            return Err(StoreError::Validation(
                "bundle recipient must be a base58 Solana public key".to_owned(),
            ));
        }

        #[allow(clippy::type_complexity)]
        let mut documents: Vec<(
            String,
            String,
            String,
            String,
            u64,
            String,
            String,
            String,
            u32,
            String,
        )> = Vec::with_capacity(handles.len());
        let now = now_ms();
        let mut connection = self.connection()?;
        require_query_access(&connection, query_id, payment_token_hash)?;
        let transaction = connection.transaction()?;
        let (_, payer_wallet) = require_prepaid_session(&transaction, wallet_session_hash, now)?;
        transaction.execute(
            "UPDATE prepaid_wallet_sessions SET last_used_at = ?1
             WHERE token_hash = ?2",
            params![as_i64(now)?, wallet_session_hash],
        )?;
        ensure_prepaid_account(
            &transaction,
            &payer_wallet,
            pay_to,
            policy.network.trim(),
            policy.asset.trim(),
            now,
        )?;
        for handle in &handles {
            let row = transaction
                .query_row(
                    "SELECT d.id, d.handle, d.author_id, p.wallet, qm.quoted_price_krw,
                            d.shelf, d.content, d.content_hash, d.version,
                            COALESCE(p.consent_version, 'seed.v1'), p.wallet_verified_at
                     FROM query_matches qm
                     JOIN documents d ON d.handle = qm.document_handle
                     LEFT JOIN profiles p ON p.user_id = d.author_id
                     WHERE qm.query_id = ?1 AND qm.document_handle = ?2 AND d.locked = 0
                       AND COALESCE(p.auto_match, 1) = 1
                       AND (SELECT COUNT(*) FROM memory_entries strikes
                            WHERE strikes.user_id = d.author_id
                              AND strikes.status = 'voided') < ?3",
                    params![query_id, handle, AUTO_MATCH_STRIKE_LIMIT as i64],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            as_u64(row.get(4)?)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            as_u64(row.get(8)?)?.min(u32::MAX as u64) as u32,
                            row.get::<_, String>(9)?,
                            row.get::<_, Option<i64>>(10)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(StoreError::DocumentNotQuoted)?;
            let recipient_wallet = if row.10.is_some() {
                row.3.filter(|wallet| !wallet.trim().is_empty())
            } else if row.2.starts_with("author_") {
                policy.fallback_recipient.clone()
            } else {
                return Err(StoreError::Conflict(format!(
                    "author of {} must verify a payout wallet before purchase",
                    row.1
                )));
            }
            .ok_or_else(|| StoreError::Conflict(format!("{} has no payout recipient", row.1)))?;
            if !valid_solana_address(&recipient_wallet) {
                return Err(StoreError::Validation(format!(
                    "payout recipient for {} is not a Solana public key",
                    row.1
                )));
            }
            documents.push((
                row.0,
                row.1,
                row.2,
                recipient_wallet,
                row.4,
                row.5,
                row.6,
                row.7,
                row.8,
                row.9,
            ));
        }

        let total_price_krw = documents.iter().try_fold(0_u64, |total, doc| {
            total.checked_add(doc.4).ok_or_else(|| {
                StoreError::Validation("bundle price exceeds the supported range".to_owned())
            })
        })?;
        // Fund the exact sum of the downstream Pay.sh charges. Rounding only
        // the aggregate can underfund the service wallet by up to N-1 atomic
        // units because each independently paid DB rounds up on its own.
        let amount_atomic = documents.iter().try_fold(0_u64, |total, document| {
            total
                .checked_add(krw_to_usdc_atomic(document.4, policy.krw_per_usdc)?)
                .ok_or_else(|| {
                    StoreError::Validation("payment amount exceeds the supported range".to_owned())
                })
        })?;
        let bundle_commitment = documents
            .iter()
            .map(|doc| {
                serde_json::json!({
                    "handle": doc.1,
                    "recipientWallet": doc.3,
                    "priceKrw": doc.4,
                    "contentHash": doc.7,
                    "documentVersion": doc.8,
                    "consentVersion": doc.9,
                })
            })
            .collect::<Vec<_>>();
        let bundle_hash = hex_digest(
            serde_json::to_string(&bundle_commitment)
                .map_err(|error| StoreError::Validation(error.to_string()))?
                .as_bytes(),
        );
        let existing = transaction
            .query_row(
                "SELECT id, expires_at, status FROM payment_bundle_quotes
                 WHERE query_id = ?1 AND pay_to = ?2 AND network = ?3 AND asset = ?4
                   AND amount_atomic = ?5 AND total_price_krw = ?6 AND krw_per_usdc = ?7
                   AND ((status = 'quoted' AND expires_at > ?8) OR status <> 'quoted')
                   AND bundle_hash = ?9 AND payer_wallet = ?10
                 ORDER BY created_at DESC LIMIT 1",
                params![
                    query_id,
                    pay_to,
                    policy.network.trim(),
                    policy.asset.trim(),
                    as_i64(amount_atomic)?,
                    as_i64(total_price_krw)?,
                    as_i64(policy.krw_per_usdc)?,
                    as_i64(now)?,
                    bundle_hash,
                    payer_wallet,
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        as_u64(row.get(1)?)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let (id, expires_at, status) = if let Some(existing) = existing {
            existing
        } else {
            let id = new_id("bundle");
            let expires_at = now.saturating_add(policy.ttl_ms);
            let available_atomic = prepaid_available(
                &transaction,
                &payer_wallet,
                pay_to,
                policy.network.trim(),
                policy.asset.trim(),
            )?;
            let deficit_atomic = amount_atomic.saturating_sub(available_atomic);
            let preferred_top_up = request
                .top_up_atomic
                .as_deref()
                .unwrap_or("0")
                .parse::<u64>()
                .map_err(|_| {
                    StoreError::Validation("topUpAtomic must be an unsigned integer".to_owned())
                })?;
            let deposit_atomic = if deficit_atomic == 0 {
                0
            } else {
                preferred_top_up.max(deficit_atomic)
            };
            if deposit_atomic > MAX_PREPAID_TOP_UP_ATOMIC {
                return Err(StoreError::Validation(
                    "prepaid top-up exceeds the supported limit".to_owned(),
                ));
            }
            let immediately_funded = deficit_atomic == 0;
            transaction.execute(
                "INSERT INTO payment_bundle_quotes
                 (id, query_id, pay_to, network, asset, amount_atomic, total_price_krw,
                  krw_per_usdc, expires_at, settled_at, created_at, bundle_hash, status,
                  payer_wallet, deposit_atomic, funding_source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, 'prepaid')",
                params![
                    id,
                    query_id,
                    pay_to,
                    policy.network.trim(),
                    policy.asset.trim(),
                    as_i64(amount_atomic)?,
                    as_i64(total_price_krw)?,
                    as_i64(policy.krw_per_usdc)?,
                    as_i64(expires_at)?,
                    immediately_funded.then_some(as_i64(now)?),
                    as_i64(now)?,
                    bundle_hash,
                    if immediately_funded {
                        "funded"
                    } else {
                        "quoted"
                    },
                    payer_wallet,
                    as_i64(deposit_atomic)?,
                ],
            )?;
            for (rank, doc) in documents.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO payment_bundle_documents
                     (quote_id, rank, document_id, document_handle, author_id,
                      recipient_wallet, price_krw, shelf_snapshot, content_snapshot,
                      content_hash, document_version, consent_version)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        id,
                        rank as i64,
                        doc.0,
                        doc.1,
                        doc.2,
                        doc.3,
                        as_i64(doc.4)?,
                        doc.5,
                        doc.6,
                        doc.7,
                        doc.8 as i64,
                        doc.9,
                    ],
                )?;
            }
            if immediately_funded {
                reserve_prepaid_budget(
                    &transaction,
                    &payer_wallet,
                    pay_to,
                    policy.network.trim(),
                    policy.asset.trim(),
                    &id,
                    amount_atomic,
                    now,
                )?;
            }
            (
                id,
                expires_at,
                if immediately_funded {
                    "funded"
                } else {
                    "quoted"
                }
                .to_owned(),
            )
        };
        transaction.commit()?;
        drop(connection);
        let quote = self.payment_bundle_quote(&id)?;
        Ok(PaymentBundleQuote {
            status,
            expires_at,
            document_handles: handles,
            ..quote
        })
    }

    pub fn payment_bundle_quote(&self, quote_id: &str) -> Result<PaymentBundleQuote, StoreError> {
        let connection = self.connection()?;
        #[allow(clippy::type_complexity)]
        let row: (
            String,
            String,
            String,
            String,
            String,
            u64,
            u64,
            u64,
            u64,
            String,
            String,
            u64,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT id, query_id, pay_to, network, asset, amount_atomic,
                        total_price_krw, krw_per_usdc, expires_at, bundle_hash, status,
                        deposit_atomic, payer_wallet
                 FROM payment_bundle_quotes WHERE id = ?1",
                [quote_id.trim()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        as_u64(row.get(5)?)?,
                        as_u64(row.get(6)?)?,
                        as_u64(row.get(7)?)?,
                        as_u64(row.get(8)?)?,
                        row.get(9)?,
                        row.get(10)?,
                        as_u64(row.get(11)?)?,
                        row.get(12)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment bundle quote"))?;
        let available_balance_atomic = row
            .12
            .as_deref()
            .map(|wallet| prepaid_available(&connection, wallet, &row.2, &row.3, &row.4))
            .transpose()?
            .unwrap_or(0);
        let mut quote = PaymentBundleQuote {
            resource_path: format!("/api/v1/paid-bundles/{}", row.0),
            id: row.0,
            query_id: row.1,
            document_handles: Vec::new(),
            pay_to: row.2,
            network: row.3,
            asset: row.4,
            amount_atomic: row.11.to_string(),
            budget_atomic: row.5.to_string(),
            requires_payment: row.10 == "quoted" && row.11 > 0,
            available_balance_atomic: available_balance_atomic.to_string(),
            total_price_krw: row.6,
            krw_per_usdc: row.7,
            expires_at: row.8,
            bundle_hash: row.9,
            status: row.10,
        };
        let mut statement = connection.prepare(
            "SELECT document_handle FROM payment_bundle_documents
             WHERE quote_id = ?1 ORDER BY rank ASC",
        )?;
        quote.document_handles = statement
            .query_map([quote_id.trim()], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(quote)
    }

    pub fn payment_bundle_snapshot(
        &self,
        quote_id: &str,
    ) -> Result<PaymentBundleSnapshot, StoreError> {
        let connection = self.connection()?;
        let bundle_hash = connection
            .query_row(
                "SELECT bundle_hash FROM payment_bundle_quotes WHERE id = ?1",
                [quote_id.trim()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment bundle quote"))?;
        let mut statement = connection.prepare(
            "SELECT document_handle, shelf_snapshot, content_snapshot, price_krw
             FROM payment_bundle_documents WHERE quote_id = ?1 ORDER BY rank ASC",
        )?;
        let citations = statement
            .query_map([quote_id.trim()], |row| {
                Ok(Citation {
                    handle: row.get(0)?,
                    shelf: row.get(1)?,
                    excerpt: row.get(2)?,
                    price: as_u64(row.get(3)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PaymentBundleSnapshot {
            quote_id: quote_id.trim().to_owned(),
            bundle_hash,
            citations,
        })
    }

    pub fn research_job_status(
        &self,
        job_id: &str,
        payment_token_hash: &str,
    ) -> Result<ResearchJobStatus, StoreError> {
        let connection = self.connection()?;
        let query_id = connection
            .query_row(
                "SELECT query_id FROM payment_bundle_quotes WHERE id = ?1",
                [job_id.trim()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("research job"))?;
        require_query_access(&connection, &query_id, payment_token_hash)?;
        load_research_job_status(&connection, job_id.trim())
    }

    pub fn research_job_plan(
        &self,
        job_id: &str,
        policy: &PaymentQuotePolicy,
    ) -> Result<ResearchJobPlan, StoreError> {
        validate_payment_policy(policy)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (payer, pay_to, network, asset, amount_atomic, status) = transaction
            .query_row(
                "SELECT payer_wallet, pay_to, network, asset, amount_atomic, status
                 FROM payment_bundle_quotes WHERE id = ?1",
                [job_id.trim()],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        as_u64(row.get(4)?)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("research job"))?;
        if !matches!(status.as_str(), "funded" | "processing") {
            return Err(StoreError::Conflict(format!(
                "research job cannot run from status {status}"
            )));
        }
        let payer = payer.ok_or_else(|| {
            StoreError::Conflict("funded research job has no payer wallet".to_owned())
        })?;
        let handles = {
            let mut statement = transaction.prepare(
                "SELECT pbd.document_handle
                 FROM payment_bundle_documents pbd
                 WHERE pbd.quote_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM payment_quotes pq
                     WHERE pq.id = pbd.pay_sh_quote_id AND pq.status = 'delivered'
                   )
                 ORDER BY pbd.rank ASC",
            )?;
            statement
                .query_map([job_id.trim()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        transaction.execute(
            "UPDATE payment_bundle_quotes SET status = 'processing'
             WHERE id = ?1 AND status = 'funded'",
            [job_id.trim()],
        )?;
        transaction.commit()?;
        drop(connection);

        let query_id = self.payment_bundle_quote(job_id)?.query_id;
        let mut resources = Vec::with_capacity(handles.len());
        for handle in handles {
            let quote = self.payment_quote(&query_id, &handle, policy)?;
            let connection = self.connection()?;
            connection.execute(
                "UPDATE payment_bundle_documents SET pay_sh_quote_id = ?1
                 WHERE quote_id = ?2 AND document_handle = ?3
                   AND NOT EXISTS (
                     SELECT 1 FROM payment_quotes current
                     WHERE current.id = payment_bundle_documents.pay_sh_quote_id
                       AND current.status = 'delivered'
                   )",
                params![quote.id, job_id.trim(), handle],
            )?;
            drop(connection);
            let mut resource = self.build_pay_sh_resource(&quote)?;
            resource
                .resource_path
                .push_str(&format!("&research_job_id={}", job_id.trim()));
            resources.push(resource);
        }
        Ok(ResearchJobPlan {
            id: job_id.trim().to_owned(),
            payer,
            pay_to,
            network,
            asset,
            amount_atomic: amount_atomic.to_string(),
            status: "processing".to_owned(),
            resources,
        })
    }

    pub fn runnable_research_jobs(&self, limit: usize) -> Result<Vec<String>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id FROM payment_bundle_quotes
             WHERE status IN ('funded', 'processing')
             ORDER BY COALESCE(settled_at, created_at) ASC LIMIT ?1",
        )?;
        Ok(statement
            .query_map([limit.clamp(1, 100) as i64], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn complete_research_job(&self, job_id: &str) -> Result<ResearchJobStatus, StoreError> {
        let connection = self.connection()?;
        let status = load_research_job_status(&connection, job_id.trim())?;
        if !status.pending_handles.is_empty() {
            return Err(StoreError::Conflict(
                "research job still has unpaid documents".to_owned(),
            ));
        }
        if !matches!(status.status.as_str(), "processing" | "completed") {
            return Err(StoreError::Conflict(format!(
                "research job cannot complete from status {}",
                status.status
            )));
        }
        if status.status != "completed" {
            let now = now_ms();
            connection.execute(
                "UPDATE payment_bundle_quotes
                 SET status = 'completed', delivered_at = ?1, failure_reason = NULL
                 WHERE id = ?2 AND status = 'processing'",
                params![as_i64(now)?, job_id.trim()],
            )?;
        }
        load_research_job_status(&connection, job_id.trim())
    }

    pub fn fail_research_job(
        &self,
        job_id: &str,
        error: &str,
    ) -> Result<ResearchJobStatus, StoreError> {
        let reason = error.trim();
        if reason.is_empty() || reason.len() > 1_000 {
            return Err(StoreError::Validation(
                "research job error must be between 1 and 1000 characters".to_owned(),
            ));
        }
        let mut connection = self.connection()?;
        let current = load_research_job_status(&connection, job_id.trim())?;
        if matches!(
            current.status.as_str(),
            "completed" | "refund_pending" | "balance_refunded"
        ) {
            return Ok(current);
        }
        if !matches!(current.status.as_str(), "funded" | "processing") {
            return Err(StoreError::Conflict(format!(
                "research job cannot fail from status {}",
                current.status
            )));
        }
        let refund_atomic = current
            .refundable_atomic
            .parse::<u64>()
            .map_err(|_| StoreError::Validation("research refund amount is invalid".to_owned()))?;
        let transaction = connection.transaction()?;
        let funding_source = transaction.query_row(
            "SELECT funding_source FROM payment_bundle_quotes WHERE id = ?1",
            [job_id.trim()],
            |row| row.get::<_, String>(0),
        )?;
        if funding_source == "prepaid" {
            let payer = current.payer.as_deref().ok_or_else(|| {
                StoreError::Conflict("prepaid research job has no payer wallet".to_owned())
            })?;
            if refund_atomic > 0 {
                release_prepaid_budget(
                    &transaction,
                    payer,
                    &current.pay_to,
                    &current.network,
                    &current.asset,
                    job_id.trim(),
                    refund_atomic,
                    now_ms(),
                )?;
            }
            transaction.execute(
                "UPDATE payment_bundle_quotes
                 SET status = 'balance_refunded', failure_reason = ?1,
                     balance_release_atomic = ?2
                 WHERE id = ?3",
                params![reason, as_i64(refund_atomic)?, job_id.trim()],
            )?;
            transaction.commit()?;
            drop(connection);
            let connection = self.connection()?;
            return load_research_job_status(&connection, job_id.trim());
        }
        let refund_claim_id = if refund_atomic > 0 {
            Some(insert_payout_claim(
                &transaction,
                None,
                None,
                &format!("research-refund:{}", job_id.trim()),
                "research_refund",
                &current.pay_to,
                current.payer.as_deref().ok_or_else(|| {
                    StoreError::Conflict("research refund has no payer wallet".to_owned())
                })?,
                &current.asset,
                &current.network,
                refund_atomic,
                current
                    .pending_handles
                    .iter()
                    .try_fold(0_u64, |sum, handle| {
                        let price = transaction.query_row(
                            "SELECT pbd.price_krw FROM payment_bundle_documents pbd
                             WHERE pbd.quote_id = ?1 AND pbd.document_handle = ?2",
                            params![job_id.trim(), handle],
                            |row| as_u64(row.get(0)?),
                        )?;
                        sum.checked_add(price).ok_or_else(|| {
                            StoreError::Validation("research refund is too large".to_owned())
                        })
                    })?,
                now_ms(),
            )?)
        } else {
            None
        };
        transaction.execute(
            "UPDATE payment_bundle_quotes
             SET status = ?1, failure_reason = ?2, refund_claim_id = ?3
             WHERE id = ?4",
            params![
                if refund_claim_id.is_some() {
                    "refund_pending"
                } else {
                    "completed"
                },
                reason,
                refund_claim_id,
                job_id.trim()
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        let connection = self.connection()?;
        load_research_job_status(&connection, job_id.trim())
    }

    pub fn record_bundle_chain_settlement(
        &self,
        request: &RecordChainSettlementRequest,
    ) -> Result<ChainSettlementReceipt, StoreError> {
        validate_chain_settlement_request(request)?;
        let amount_atomic = request.amount_atomic.parse::<u64>().map_err(|_| {
            StoreError::Validation("amountAtomic must be an unsigned integer".to_owned())
        })?;
        let raw_response_json = settlement_raw_json(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT id, quote_id, transaction_signature, payer, pay_to,
                        amount_atomic, network, confirmed_at
                 FROM bundle_chain_settlements WHERE quote_id = ?1",
                [request.quote_id.trim()],
                chain_settlement_from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.transaction_signature == request.transaction_signature.trim()
                && existing.payer == request.payer.trim()
                && existing.pay_to == request.pay_to.trim()
                && existing.amount_atomic == request.amount_atomic
                && existing.network == request.network.trim()
            {
                return Ok(existing);
            }
            return Err(StoreError::Conflict(
                "this payment bundle has already been settled".to_owned(),
            ));
        }
        let signature = request.transaction_signature.trim();
        let signature_used = transaction
            .query_row(
                "SELECT 1 FROM chain_settlements WHERE transaction_signature = ?1
                 UNION ALL
                 SELECT 1 FROM bundle_chain_settlements WHERE transaction_signature = ?1
                 LIMIT 1",
                [signature],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if signature_used {
            return Err(StoreError::Conflict(
                "this transaction signature has already been recorded".to_owned(),
            ));
        }
        let (
            query_id,
            pay_to,
            network,
            asset,
            budget_atomic,
            deposit_atomic,
            total_price_krw,
            expected_payer,
            funding_source,
            quote_status,
        ) = transaction
            .query_row(
                "SELECT query_id, pay_to, network, asset, amount_atomic, deposit_atomic,
                        total_price_krw, payer_wallet, funding_source, status
                     FROM payment_bundle_quotes WHERE id = ?1",
                [request.quote_id.trim()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        as_u64(row.get(4)?)?,
                        as_u64(row.get(5)?)?,
                        as_u64(row.get(6)?)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment bundle quote"))?;
        if quote_status != "quoted"
            || funding_source != "prepaid"
            || expected_payer.as_deref() != Some(request.payer.trim())
            || pay_to != request.pay_to.trim()
            || network != request.network.trim()
            || deposit_atomic != amount_atomic
        {
            return Err(StoreError::Conflict(
                "settlement does not match the payment bundle quote".to_owned(),
            ));
        }
        #[allow(clippy::type_complexity)]
        let documents = {
            let mut statement = transaction.prepare(
                "SELECT document_id, document_handle, author_id, recipient_wallet, price_krw,
                        (SELECT m.id FROM memory_entries m
                         WHERE m.document_id = pbd.document_id AND m.status = 'settled' LIMIT 1)
                 FROM payment_bundle_documents pbd WHERE quote_id = ?1 ORDER BY rank ASC",
            )?;
            statement
                .query_map([request.quote_id.trim()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        as_u64(row.get(4)?)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if documents.is_empty() {
            return Err(StoreError::Conflict("payment bundle is empty".to_owned()));
        }
        let confirmed_at = now_ms();
        let settlement_id = new_id("settlement");
        let chain_id = new_id("bundle-chain");
        let handles_json = serde_json::to_string(
            &documents
                .iter()
                .map(|document| &document.1)
                .collect::<Vec<_>>(),
        )
        .expect("handles are serialisable");
        transaction.execute(
            "INSERT INTO settlements
             (id, query_id, payer, document_handles_json, total_krw, mode,
              transaction_signature, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'x402_solana_bundle_escrow', ?6, ?7)",
            params![
                settlement_id,
                query_id,
                request.payer.trim(),
                handles_json,
                as_i64(total_price_krw)?,
                signature,
                as_i64(confirmed_at)?,
            ],
        )?;
        credit_prepaid_deposit(
            &transaction,
            request.payer.trim(),
            &pay_to,
            &network,
            &asset,
            signature,
            deposit_atomic,
            confirmed_at,
        )?;
        reserve_prepaid_budget(
            &transaction,
            request.payer.trim(),
            &pay_to,
            &network,
            &asset,
            request.quote_id.trim(),
            budget_atomic,
            confirmed_at,
        )?;
        transaction.execute(
            "INSERT INTO bundle_chain_settlements
             (id, quote_id, settlement_id, transaction_signature, payer, pay_to,
              amount_atomic, network, raw_response_json, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                chain_id,
                request.quote_id.trim(),
                settlement_id,
                signature,
                request.payer.trim(),
                request.pay_to.trim(),
                as_i64(amount_atomic)?,
                request.network.trim(),
                raw_response_json,
                as_i64(confirmed_at)?,
            ],
        )?;
        // This transfer funds the bounded service wallet; it does not open or
        // accrue any document by itself. Every author is paid later by the
        // official Pay.sh resource, which is the only delivery boundary.
        transaction.execute(
            "UPDATE payment_bundle_quotes
             SET settled_at = ?1, status = 'funded'
             WHERE id = ?2",
            params![as_i64(confirmed_at)?, request.quote_id.trim()],
        )?;
        transaction.commit()?;
        Ok(ChainSettlementReceipt {
            id: chain_id,
            quote_id: request.quote_id.trim().to_owned(),
            transaction_signature: signature.to_owned(),
            payer: request.payer.trim().to_owned(),
            pay_to,
            amount_atomic: amount_atomic.to_string(),
            network,
            confirmed_at,
        })
    }

    pub fn paid_document(&self, quote_id: &str) -> Result<PaidDocument, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (id, handle, shelf, content, price, content_hash, version, delivered_at, document_id) =
            transaction
                .query_row(
                    "SELECT id, document_handle, shelf_snapshot, content_snapshot, price_krw,
                            content_hash, document_version, delivered_at, document_id
                     FROM payment_quotes WHERE id = ?1 AND settled_at IS NOT NULL",
                    [quote_id.trim()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            as_u64(row.get(4)?)?,
                            row.get::<_, String>(5)?,
                            as_u64(row.get(6)?)?.min(u32::MAX as u64) as u32,
                            row.get::<_, Option<i64>>(7)?.map(as_u64).transpose()?,
                            row.get::<_, String>(8)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(StoreError::NotFound("settled payment quote"))?;
        let delivered_at = delivered_at.unwrap_or_else(now_ms);
        let first_delivery = transaction.execute(
            "UPDATE payment_quotes SET delivered_at = ?1, status = 'delivered'
             WHERE id = ?2 AND delivered_at IS NULL",
            params![as_i64(delivered_at)?, id],
        )? == 1;
        if first_delivery {
            let memory_id = transaction
                .query_row(
                    "SELECT id FROM memory_entries WHERE document_id = ?1 LIMIT 1",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            transaction.execute(
                "INSERT INTO memory_access_events
                 (id, memory_id, document_id, quote_id, actor, purpose, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'x402_payer', 'paid_evidence', ?5)",
                params![
                    new_id("access"),
                    memory_id,
                    document_id,
                    id,
                    as_i64(delivered_at)?
                ],
            )?;
            transaction.execute(
                "UPDATE memory_entries SET access_count = access_count + 1,
                    last_accessed_at = ?1 WHERE document_id = ?2",
                params![as_i64(delivered_at)?, document_id],
            )?;
        }
        transaction.commit()?;
        Ok(PaidDocument {
            quote_id: id,
            content_hash,
            document_version: version,
            delivered_at,
            citation: Citation {
                handle,
                shelf,
                excerpt: content,
                price,
            },
        })
    }

    /// Returns the immutable content committed into a quote to the trusted
    /// gateway while the x402 middleware is buffering the HTTP response.
    /// Unlike `paid_document`, this does not mark delivery or expose a public
    /// route; the middleware discards the buffer if settlement fails.
    pub fn payment_document_snapshot(
        &self,
        quote_id: &str,
    ) -> Result<PaymentDocumentSnapshot, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT id, document_handle, shelf_snapshot, content_snapshot, price_krw,
                        content_hash, document_version
                 FROM payment_quotes WHERE id = ?1",
                [quote_id.trim()],
                |row| {
                    Ok(PaymentDocumentSnapshot {
                        quote_id: row.get(0)?,
                        citation: Citation {
                            handle: row.get(1)?,
                            shelf: row.get(2)?,
                            excerpt: row.get(3)?,
                            price: as_u64(row.get(4)?)?,
                        },
                        content_hash: row.get(5)?,
                        document_version: as_u64(row.get(6)?)?.min(u32::MAX as u64) as u32,
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment quote"))
    }

    pub fn record_chain_settlement(
        &self,
        request: &RecordChainSettlementRequest,
    ) -> Result<ChainSettlementReceipt, StoreError> {
        let signature = request.transaction_signature.trim();
        if !(64..=128).contains(&signature.len()) || !is_base58(signature) {
            return Err(StoreError::Validation(
                "transactionSignature must be a base58 Solana signature".to_owned(),
            ));
        }
        if !valid_solana_address(request.payer.trim())
            || !valid_solana_address(request.pay_to.trim())
        {
            return Err(StoreError::Validation(
                "payer and payTo must be base58 Solana public keys".to_owned(),
            ));
        }
        let amount_atomic = request.amount_atomic.parse::<u64>().map_err(|_| {
            StoreError::Validation("amountAtomic must be an unsigned integer".to_owned())
        })?;
        let raw_response_json = serde_json::to_string(&request.raw_response)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        if raw_response_json.len() > 32_768 {
            return Err(StoreError::Validation(
                "rawResponse must be at most 32768 bytes".to_owned(),
            ));
        }

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT id, quote_id, transaction_signature, payer, pay_to,
                        amount_atomic, network, confirmed_at
                 FROM chain_settlements WHERE quote_id = ?1",
                [request.quote_id.trim()],
                chain_settlement_from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.transaction_signature == signature
                && existing.payer == request.payer.trim()
                && existing.pay_to == request.pay_to.trim()
                && existing.amount_atomic == request.amount_atomic
                && existing.network == request.network.trim()
            {
                return Ok(existing);
            }
            return Err(StoreError::Conflict(
                "this payment quote has already been settled".to_owned(),
            ));
        }
        if transaction
            .query_row(
                "SELECT 1 FROM bundle_chain_settlements WHERE transaction_signature = ?1",
                [signature],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Err(StoreError::Conflict(
                "this transaction signature has already been recorded".to_owned(),
            ));
        }

        let (
            query_id,
            document_id,
            handle,
            pay_to,
            network,
            quoted_atomic,
            price_krw,
            author_id,
            memory_id,
        ) = transaction
            .query_row(
                "SELECT pq.query_id, pq.document_id, pq.document_handle, pq.pay_to,
                        pq.network, pq.amount_atomic, pq.price_krw,
                        d.author_id,
                        (SELECT m.id FROM memory_entries m
                         WHERE m.document_id = d.id AND m.status = 'settled' LIMIT 1)
                 FROM payment_quotes pq
                 JOIN documents d ON d.id = pq.document_id
                 WHERE pq.id = ?1",
                [request.quote_id.trim()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        as_u64(row.get(5)?)?,
                        as_u64(row.get(6)?)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment quote"))?;

        if pay_to != request.pay_to.trim()
            || network != request.network.trim()
            || quoted_atomic != amount_atomic
        {
            return Err(StoreError::Conflict(
                "settlement does not match the payment quote".to_owned(),
            ));
        }

        let confirmed_at = now_ms();
        let settlement_id = new_id("settlement");
        let chain_id = new_id("chain");
        let handles_json = serde_json::to_string(&[&handle]).expect("handle is serialisable");
        transaction.execute(
            "INSERT INTO settlements
             (id, query_id, payer, document_handles_json, total_krw, mode,
              transaction_signature, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'x402_solana', ?6, ?7)",
            params![
                settlement_id,
                query_id,
                request.payer.trim(),
                handles_json,
                as_i64(price_krw)?,
                signature,
                as_i64(confirmed_at)?,
            ],
        )?;
        transaction.execute(
            "INSERT INTO chain_settlements
             (id, quote_id, settlement_id, transaction_signature, payer, pay_to,
              amount_atomic, network, raw_response_json, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                chain_id,
                request.quote_id.trim(),
                settlement_id,
                signature,
                request.payer.trim(),
                request.pay_to.trim(),
                as_i64(amount_atomic)?,
                request.network.trim(),
                raw_response_json,
                as_i64(confirmed_at)?,
            ],
        )?;
        transaction.execute(
            "UPDATE payment_quotes
             SET settled_at = ?1, delivered_at = ?1, status = 'delivered' WHERE id = ?2",
            params![as_i64(confirmed_at)?, request.quote_id.trim()],
        )?;
        transaction.execute(
            "UPDATE memory_entries SET earned_krw = earned_krw + ?1,
                access_count = access_count + 1, last_accessed_at = ?2
             WHERE document_id = ?3 AND status = 'settled'",
            params![as_i64(price_krw)?, as_i64(confirmed_at)?, document_id],
        )?;
        transaction.execute(
            "INSERT INTO memory_access_events
             (id, memory_id, document_id, quote_id, actor, purpose, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'paid_evidence', ?6)",
            params![
                new_id("access"),
                memory_id,
                document_id,
                request.quote_id.trim(),
                request.payer.trim(),
                as_i64(confirmed_at)?,
            ],
        )?;
        insert_onchain_earning_event(
            &transaction,
            &settlement_id,
            memory_id.as_deref(),
            &document_id,
            &author_id,
            price_krw,
            &pay_to,
            confirmed_at,
        )?;
        transaction.commit()?;

        Ok(ChainSettlementReceipt {
            id: chain_id,
            quote_id: request.quote_id.trim().to_owned(),
            transaction_signature: signature.to_owned(),
            payer: request.payer.trim().to_owned(),
            pay_to,
            amount_atomic: amount_atomic.to_string(),
            network,
            confirmed_at,
        })
    }

    pub fn open_documents(
        &self,
        query_id: &str,
        handles: &[String],
        payer: Option<&str>,
    ) -> Result<OpenDocumentsResponse, StoreError> {
        if handles.is_empty() || handles.len() > 20 {
            return Err(StoreError::Validation(
                "between 1 and 20 document handles are required".to_owned(),
            ));
        }
        let unique_handles = handles.iter().collect::<HashSet<_>>();
        if unique_handles.len() != handles.len() {
            return Err(StoreError::Validation(
                "document handles must be unique".to_owned(),
            ));
        }
        let mut canonical_handles = handles.to_vec();
        canonical_handles.sort_unstable();
        let canonical_handles_json =
            serde_json::to_string(&canonical_handles).expect("handles are serialisable");

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let query_exists = transaction
            .query_row(
                "SELECT 1 FROM queries WHERE id = ?1",
                [query_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !query_exists {
            return Err(StoreError::NotFound("query"));
        }

        // A browser or payment gateway may retry after losing the first response.
        // Replaying the same purchased set must not accrue the authors twice.
        let existing_settlement_id = transaction
            .query_row(
                "SELECT id FROM settlements
                 WHERE query_id = ?1 AND document_handles_json = ?2
                   AND COALESCE(payer, '') = COALESCE(?3, '')",
                params![query_id, canonical_handles_json, payer],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let replay = existing_settlement_id.is_some();
        let settlement_id = existing_settlement_id.unwrap_or_else(|| new_id("settlement"));

        let mut opened_documents = Vec::with_capacity(handles.len());
        let mut total = 0_u64;
        for handle in handles {
            let opened = transaction
                .query_row(
                    "SELECT d.handle, d.shelf, d.content, qm.quoted_price_krw, d.id,
                            d.author_id,
                            (SELECT m.id FROM memory_entries m
                             WHERE m.document_id = d.id AND m.status = 'settled' LIMIT 1)
                     FROM query_matches qm
                     JOIN documents d ON d.handle = qm.document_handle
                     LEFT JOIN profiles p ON p.user_id = d.author_id
                     WHERE qm.query_id = ?1 AND qm.document_handle = ?2 AND d.locked = 0
                       AND COALESCE(p.auto_match, 1) = 1
                       AND (SELECT COUNT(*) FROM memory_entries strikes
                            WHERE strikes.user_id = d.author_id
                              AND strikes.status = 'voided') < ?3",
                    params![query_id, handle, AUTO_MATCH_STRIKE_LIMIT as i64],
                    |row| {
                        Ok((
                            Citation {
                                handle: row.get(0)?,
                                shelf: row.get(1)?,
                                excerpt: row.get(2)?,
                                price: as_u64(row.get(3)?)?,
                            },
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, Option<String>>(6)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(StoreError::DocumentNotQuoted)?;
            total = total.saturating_add(opened.0.price);
            opened_documents.push(opened);
        }

        if !replay {
            let created_at = now_ms();
            transaction.execute(
                "INSERT INTO settlements
                 (id, query_id, payer, document_handles_json, total_krw, mode,
                  transaction_signature, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'demo', NULL, ?6)",
                params![
                    settlement_id,
                    query_id,
                    payer,
                    canonical_handles_json,
                    as_i64(total)?,
                    as_i64(created_at)?,
                ],
            )?;
            for (citation, document_id, author_id, memory_id) in &opened_documents {
                transaction.execute(
                    "UPDATE memory_entries SET earned_krw = earned_krw + ?1
                     WHERE document_id = ?2 AND status = 'settled'",
                    params![as_i64(citation.price)?, document_id],
                )?;
                insert_earning_event(
                    &transaction,
                    Some(&settlement_id),
                    memory_id.as_deref(),
                    Some(document_id),
                    author_id,
                    "document_open",
                    citation.price,
                    created_at,
                )?;
            }
        }
        transaction.commit()?;
        let citations = opened_documents
            .into_iter()
            .map(|(citation, _, _, _)| citation)
            .collect::<Vec<_>>();

        Ok(OpenDocumentsResponse {
            settlement: Settlement {
                id: settlement_id,
                count: citations.len(),
                total,
                tx_sig: None,
                network: Some("demo".to_owned()),
            },
            citations,
        })
    }
}

fn require_query_access(
    connection: &Connection,
    query_id: &str,
    payment_token_hash: &str,
) -> Result<(), StoreError> {
    if payment_token_hash.len() != 64
        || !payment_token_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(StoreError::Unauthorized(
            "invalid query payment token".to_owned(),
        ));
    }
    let allowed = connection
        .query_row(
            "SELECT 1 FROM queries
             WHERE id = ?1 AND payment_token_hash = ?2
               AND payment_token_expires_at > ?3",
            params![query_id, payment_token_hash, as_i64(now_ms())?],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !allowed {
        return Err(StoreError::Unauthorized(
            "invalid query payment token".to_owned(),
        ));
    }
    Ok(())
}

fn liquidity_state_name(state: LiquidityState) -> &'static str {
    match state {
        LiquidityState::AiLiquidityOnly => "ai_liquidity_only",
        LiquidityState::HybridCoverage => "hybrid_coverage",
        LiquidityState::HumanCovered => "human_covered",
    }
}

fn load_ai_baseline(
    connection: &Connection,
    query_id: &str,
    now: u64,
) -> Result<Option<AiBaseline>, StoreError> {
    type StoredBaseline = (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        u64,
        u64,
    );
    let stored = connection
        .query_row(
            "SELECT id, orientation, general_points_json, human_gaps_json,
                    questions_for_people_json, model, mode, policy_version,
                    generated_at, expires_at
             FROM ai_baselines
             WHERE query_id = ?1 AND expires_at > ?2",
            params![query_id, as_i64(now)?],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    as_u64(row.get(8)?)?,
                    as_u64(row.get(9)?)?,
                ))
            },
        )
        .optional()?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    let (
        id,
        orientation,
        general_points_json,
        human_gaps_json,
        questions_for_people_json,
        model,
        mode,
        policy_version,
        generated_at,
        expires_at,
    ): StoredBaseline = stored;
    let parse_list = |json: &str| {
        serde_json::from_str::<Vec<String>>(json)
            .map_err(|_| StoreError::Validation("stored AI baseline is malformed".to_owned()))
    };
    Ok(Some(AiBaseline {
        id,
        query_id: query_id.to_owned(),
        kind: "ai_baseline",
        orientation,
        general_points: parse_list(&general_points_json)?,
        human_gaps: parse_list(&human_gaps_json)?,
        questions_for_people: parse_list(&questions_for_people_json)?,
        model,
        mode,
        policy_version,
        generated_at,
        expires_at,
        price_krw: 0,
        sellable: false,
        counts_as_human_coverage: false,
    }))
}

fn production_environment() -> bool {
    std::env::var("OPENSHELF_ENV").ok().is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "production" | "prod"
        )
    })
}

fn env_flag(name: &str, fallback: bool) -> bool {
    match std::env::var(name)
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("1" | "true" | "yes" | "on") => true,
        Some("0" | "false" | "no" | "off") => false,
        _ => fallback,
    }
}

fn validate_profile(request: &UpsertProfileRequest) -> Result<(), StoreError> {
    let handle = request.handle.trim();
    if !(3..=32).contains(&handle.len())
        || !handle
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-".contains(character))
    {
        return Err(StoreError::Validation(
            "handle must be 3-32 ASCII letters, numbers, underscores, or hyphens".to_owned(),
        ));
    }
    for (name, value) in [
        ("ageBand", request.age_band.as_str()),
        ("region", request.region.as_str()),
        ("household", request.household.as_str()),
        ("field", request.field.as_str()),
        ("years", request.years.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 80 {
            return Err(StoreError::Validation(format!(
                "{name} must be between 1 and 80 characters"
            )));
        }
    }
    for (name, value, allowed) in [
        ("ageBand", request.age_band.trim(), AGE_BANDS),
        ("region", request.region.trim(), REGIONS),
        ("household", request.household.trim(), HOUSEHOLDS),
        ("field", request.field.trim(), CATEGORY_IDS),
        ("years", request.years.trim(), YEAR_BANDS),
    ] {
        if !allowed.contains(&value) {
            return Err(StoreError::Validation(format!("unsupported {name}")));
        }
    }
    if request.speaks_to.is_empty() || request.speaks_to.len() > 10 {
        return Err(StoreError::Validation(
            "speaksTo must contain between 1 and 10 fields".to_owned(),
        ));
    }
    let unique_fields = request
        .speaks_to
        .iter()
        .map(|field| field.trim())
        .collect::<HashSet<_>>();
    if unique_fields.len() != request.speaks_to.len()
        || unique_fields
            .iter()
            .any(|field| !CATEGORY_IDS.contains(field))
    {
        return Err(StoreError::Validation(
            "speaksTo fields must be unique supported categories".to_owned(),
        ));
    }
    if let Some(wallet) = request.wallet.as_deref() {
        let wallet = wallet.trim();
        if !wallet.is_empty() && !valid_solana_address(wallet) {
            return Err(StoreError::Validation(
                "wallet must be a base58 Solana public key".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_filters(filters: &SearchFilters) -> Result<(), StoreError> {
    for (name, value, allowed) in [
        ("ageBand", filters.age_band.as_deref(), AGE_BANDS),
        ("region", filters.region.as_deref(), REGIONS),
        ("household", filters.household.as_deref(), HOUSEHOLDS),
        ("field", filters.field.as_deref(), CATEGORY_IDS),
    ] {
        if value.is_some_and(|value| !allowed.contains(&value)) {
            return Err(StoreError::Validation(format!("unsupported {name} filter")));
        }
    }
    if filters
        .category
        .as_deref()
        .is_some_and(|value| !CATEGORY_IDS.contains(&value))
    {
        return Err(StoreError::Validation(
            "unsupported category filter".to_owned(),
        ));
    }
    if filters
        .max_unit_price_krw
        .is_some_and(|value| value > 10_000_000)
    {
        return Err(StoreError::Validation(
            "maxUnitPriceKrw must be at most 10000000".to_owned(),
        ));
    }
    Ok(())
}

#[derive(Debug)]
struct AgentMemorySource {
    memory_id: String,
    document_id: String,
    answer: String,
    content_hash: String,
    importance: f32,
    reliability_score: f32,
    similarity: f32,
}

fn question_terms(value: &str) -> HashSet<String> {
    value
        .split_whitespace()
        .map(|term| {
            term.trim_matches(|character: char| !character.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|term| term.chars().count() >= 2)
        .collect()
}

fn question_similarity(left: &str, right: &str) -> f32 {
    let left_normalized = left
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    let right_normalized = right
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if !left_normalized.is_empty() && left_normalized == right_normalized {
        return 1.0;
    }
    let left = question_terms(left);
    let right = question_terms(right);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(&right).count() as f32;
    let union = left.union(&right).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn active_reservation_count(
    connection: &Connection,
    open_call_id: &str,
) -> Result<usize, StoreError> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM open_call_reservations
         WHERE open_call_id = ?1 AND expires_at > ?2",
        params![open_call_id, as_i64(now_ms())?],
        |row| as_usize(row.get(0)?),
    )?)
}

fn active_reservation_expiry(
    connection: &Connection,
    open_call_id: &str,
    user_id: &str,
) -> Result<Option<u64>, StoreError> {
    Ok(connection
        .query_row(
            "SELECT expires_at FROM open_call_reservations
             WHERE open_call_id = ?1 AND user_id = ?2 AND expires_at > ?3",
            params![open_call_id, user_id, as_i64(now_ms())?],
            |row| as_u64(row.get(0)?),
        )
        .optional()?)
}

fn call_recommendation(
    connection: &Connection,
    user_id: &str,
    profile: &UserProfile,
    call: &StoredCall,
) -> Result<(f32, Vec<String>), StoreError> {
    if call.owner_id == user_id
        || call.status != "open"
        || call.answered >= call.target
        || !profile_matches(profile, &call.filters)
        || profile.suspended
    {
        return Ok((0.0, Vec::new()));
    }
    let mut score = 0.55_f32;
    let mut reasons = vec!["Profile matches every target band".to_owned()];
    if profile.field == call.category {
        score += 0.1;
        reasons.push("This is your primary field".to_owned());
    }
    let mut statement = connection.prepare(
        "SELECT question, shelf FROM memory_entries
         WHERE user_id = ?1 AND status = 'settled' AND locked = 0
         ORDER BY created_at DESC LIMIT 100",
    )?;
    let memories = statement
        .query_map([user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut best_similarity = 0.0_f32;
    let mut same_shelf = false;
    for (question, shelf) in memories {
        best_similarity = best_similarity.max(question_similarity(&question, &call.question));
        same_shelf |= shelf == call.shelf;
    }
    if same_shelf {
        score += 0.08;
        reasons.push("You already have memory on this shelf".to_owned());
    }
    if best_similarity >= 0.25 {
        score += best_similarity.min(1.0) * 0.2;
        reasons.push(format!(
            "A prior memory is {:.0}% similar",
            best_similarity * 100.0
        ));
    }
    Ok((score.min(1.0), reasons))
}

fn best_agent_memory(
    transaction: &Transaction<'_>,
    user_id: &str,
    call: &StoredCall,
) -> Result<Option<AgentMemorySource>, StoreError> {
    let mut statement = transaction.prepare(
        "SELECT m.id, m.document_id, m.question, m.answer, m.content_hash,
                m.importance, m.reliability_score, d.price_krw, m.shelf
         FROM memory_entries m
         JOIN documents d ON d.id = m.document_id
         WHERE m.user_id = ?1 AND m.status = 'settled' AND m.locked = 0
           AND d.locked = 0 AND d.category = ?2
         ORDER BY m.created_at DESC LIMIT 100",
    )?;
    let candidates = statement
        .query_map(params![user_id, call.category], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, f32>(5)?,
                row.get::<_, f32>(6)?,
                as_u64(row.get(7)?)?,
                row.get::<_, String>(8)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut best: Option<AgentMemorySource> = None;
    for (
        memory_id,
        document_id,
        question,
        answer,
        content_hash,
        importance,
        reliability,
        price,
        _shelf,
    ) in candidates
    {
        if price > call.unit_price {
            continue;
        }
        let similarity = question_similarity(&question, &call.question);
        if similarity < AGENT_MATCH_THRESHOLD {
            continue;
        }
        if best
            .as_ref()
            .is_none_or(|current| similarity > current.similarity)
        {
            best = Some(AgentMemorySource {
                memory_id,
                document_id,
                answer,
                content_hash,
                importance,
                reliability_score: reliability,
                similarity,
            });
        }
    }
    Ok(best)
}

fn settle_agent_match(
    transaction: &Transaction<'_>,
    call: &StoredCall,
    user_id: &str,
    profile: &UserProfile,
    source: &AgentMemorySource,
) -> Result<(), StoreError> {
    if call.escrow_remaining_krw < call.unit_price {
        return Err(StoreError::Conflict(
            "open-call escrow is exhausted".to_owned(),
        ));
    }
    let created_at = now_ms();
    let memory_id = new_id("memory");
    let onchain_payout = if call.escrow_mode == "x402_solana_escrow" {
        let wallet = profile
            .wallet
            .as_deref()
            .filter(|_| profile.wallet_verified)
            .filter(|wallet| valid_solana_address(wallet));
        if let Some(wallet) = wallet {
            Some((wallet.to_owned(), open_call_answer_atomic(call)?))
        } else {
            None
        }
    } else {
        None
    };
    if call.escrow_mode == "x402_solana_escrow" && onchain_payout.is_none() {
        // Automatic reuse must never create an unpayable human contribution.
        return Ok(());
    }
    if let Some((_, payout_atomic)) = &onchain_payout {
        let changed = transaction.execute(
            "UPDATE open_calls SET answered = answered + 1,
                escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                escrow_remaining_atomic = escrow_remaining_atomic - ?1,
                status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
             WHERE id = ?2 AND status = 'open' AND answered < target
               AND escrow_remaining_atomic >= ?1",
            params![as_i64(*payout_atomic)?, call.id],
        )?;
        if changed == 0 {
            return Err(StoreError::Conflict(
                "open-call on-chain escrow is exhausted".to_owned(),
            ));
        }
    } else {
        transaction.execute(
            "UPDATE open_calls SET answered = answered + 1,
                escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
             WHERE id = ?1 AND status = 'open' AND answered < target",
            [call.id.as_str()],
        )?;
        let changed = transaction.execute(
            "UPDATE balances SET reserved_krw = reserved_krw - ?1, updated_at = ?2
             WHERE user_id = ?3 AND reserved_krw >= ?1",
            params![as_i64(call.unit_price)?, as_i64(created_at)?, call.owner_id],
        )?;
        if changed == 0 && call.unit_price > 0 {
            return Err(StoreError::Conflict(
                "reserved balance is inconsistent with this call".to_owned(),
            ));
        }
    }
    transaction.execute(
        "INSERT INTO memory_entries
         (id, user_id, open_call_id, document_id, question, answer, shelf,
          earned_krw, created_at, via, status, flags_json, interview_json,
          memory_type, importance, content_hash, reliability_score, source_ids_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Auto-match', 'settled',
                 '[]', '[]', 'observation', ?10, ?11, ?12, ?13)",
        params![
            memory_id,
            user_id,
            call.id,
            source.document_id,
            call.question,
            source.answer,
            call.shelf,
            as_i64(call.unit_price)?,
            as_i64(created_at)?,
            source.importance,
            if source.content_hash.is_empty() {
                sha256_hex(&source.answer)
            } else {
                source.content_hash.clone()
            },
            source.reliability_score,
            serde_json::to_string(&[source.memory_id.as_str()])
                .expect("source ids are serialisable"),
        ],
    )?;
    if let Some((recipient_wallet, payout_atomic)) = &onchain_payout {
        let earning_id = insert_open_call_onchain_earning_event(
            transaction,
            Some(&memory_id),
            Some(&source.document_id),
            user_id,
            call.unit_price,
            recipient_wallet,
            created_at,
        )?;
        insert_payout_claim(
            transaction,
            Some(&earning_id),
            Some(&call.id),
            user_id,
            "open_call_auto_match",
            call.escrow_wallet.as_deref().ok_or_else(|| {
                StoreError::Conflict("funded call has no escrow wallet".to_owned())
            })?,
            recipient_wallet,
            call.escrow_asset.as_deref().ok_or_else(|| {
                StoreError::Conflict("funded call has no escrow asset".to_owned())
            })?,
            call.escrow_network.as_deref().ok_or_else(|| {
                StoreError::Conflict("funded call has no escrow network".to_owned())
            })?,
            *payout_atomic,
            call.unit_price,
            created_at,
        )?;
    } else {
        insert_earning_event(
            transaction,
            None,
            Some(&memory_id),
            Some(&source.document_id),
            user_id,
            "open_call",
            call.unit_price,
            created_at,
        )?;
    }
    insert_notification(
        transaction,
        user_id,
        "auto_matched",
        "Your memory answered a new call",
        &format!(
            "A {:.0}% match reused your original answer and earned ₩{}.",
            source.similarity * 100.0,
            call.unit_price
        ),
        Some(&call.id),
    )?;
    insert_notification(
        transaction,
        &call.owner_id,
        "answer_received",
        "A new answer arrived",
        &format!(
            "{}/{} answers collected for {}",
            call.answered + 1,
            call.target,
            call.question
        ),
        Some(&call.id),
    )?;
    if call.answered + 1 >= call.target {
        insert_notification(
            transaction,
            &call.owner_id,
            "call_filled",
            "Your open call is complete",
            &format!("All {} answers are ready to read.", call.target),
            Some(&call.id),
        )?;
        transaction.execute(
            "DELETE FROM open_call_reservations WHERE open_call_id = ?1",
            [call.id.as_str()],
        )?;
    }
    Ok(())
}

fn insert_notification(
    transaction: &Transaction<'_>,
    user_id: &str,
    kind: &str,
    title: &str,
    body: &str,
    open_call_id: Option<&str>,
) -> Result<(), StoreError> {
    let id = new_id("notification");
    let created_at = now_ms();
    let changed = transaction.execute(
        "INSERT OR IGNORE INTO contributor_notifications
         (id, user_id, kind, title, body, open_call_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            user_id,
            kind,
            title,
            body,
            open_call_id,
            as_i64(created_at)?
        ],
    )?;
    if changed == 0 {
        return Ok(());
    }
    let email = transaction
        .query_row(
            "SELECT u.email FROM users u JOIN profiles p ON p.user_id = u.id
             WHERE u.id = ?1 AND u.deleted_at IS NULL AND p.email_alerts = 1",
            [user_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(email) = email {
        transaction.execute(
            "INSERT OR IGNORE INTO email_outbox
             (id, notification_id, recipient, subject, body, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                new_id("email"),
                id,
                email,
                format!("OPENSHELF · {title}"),
                body,
                as_i64(created_at)?,
            ],
        )?;
    }
    Ok(())
}

fn create_call_notifications(
    transaction: &Transaction<'_>,
    call: &StoredCall,
) -> Result<(), StoreError> {
    if call.status != "open" || call.answered >= call.target {
        return Ok(());
    }
    let mut statement = transaction.prepare(
        "SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id
         WHERE p.user_id <> ?1 AND u.deleted_at IS NULL",
    )?;
    let users = statement
        .query_map([call.owner_id.as_str()], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for user_id in users {
        let Some(profile) = load_profile(transaction, &user_id)? else {
            continue;
        };
        if profile.suspended || !profile_matches(&profile, &call.filters) {
            continue;
        }
        let answered = transaction
            .query_row(
                "SELECT 1 FROM memory_entries WHERE open_call_id = ?1 AND user_id = ?2",
                params![call.id, user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if answered {
            continue;
        }
        insert_notification(
            transaction,
            &user_id,
            "call_available",
            "A paid question fits you",
            &format!("₩{} per answer · {}", call.unit_price, call.question),
            Some(&call.id),
        )?;
    }
    Ok(())
}

fn materialize_call_notifications(
    transaction: &Transaction<'_>,
    user_id: &str,
) -> Result<(), StoreError> {
    let user_exists = transaction
        .query_row(
            "SELECT 1 FROM users WHERE id = ?1 AND deleted_at IS NULL",
            [user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !user_exists {
        return Ok(());
    }
    let Some(profile) = load_profile(transaction, user_id)? else {
        return Ok(());
    };
    if profile.suspended {
        return Ok(());
    }
    let mut statement = transaction.prepare(
        "SELECT id, owner_id, question, unit_price_krw, target, answered,
                created_at, chat_id, shelf, category, target_age_band,
                target_region, target_household, target_field,
                escrow_remaining_krw, status, escrow_mode, escrow_wallet,
                escrow_asset, escrow_network, escrow_total_atomic,
                escrow_remaining_atomic, funding_transaction_signature, payer_wallet
         FROM open_calls WHERE status = 'open' AND answered < target AND owner_id <> ?1",
    )?;
    let calls = statement
        .query_map([user_id], stored_call_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for call in calls {
        if !profile_matches(&profile, &call.filters) {
            continue;
        }
        let answered = transaction
            .query_row(
                "SELECT 1 FROM memory_entries WHERE open_call_id = ?1 AND user_id = ?2",
                params![call.id, user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !answered {
            insert_notification(
                transaction,
                user_id,
                "call_available",
                "A paid question fits you",
                &format!("₩{} per answer · {}", call.unit_price, call.question),
                Some(&call.id),
            )?;
        }
    }
    Ok(())
}

fn notification_from_row(row: &db::Row) -> db::Result<ContributorNotification> {
    Ok(ContributorNotification {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        open_call_id: row.get(4)?,
        created_at: as_u64(row.get(5)?)?,
        read_at: row.get::<_, Option<i64>>(6)?.map(as_u64).transpose()?,
    })
}

fn wallet_siwx_challenge_from_row(row: &db::Row) -> db::Result<WalletSiwxChallengeRecord> {
    Ok(WalletSiwxChallengeRecord {
        id: row.get(0)?,
        user_id: row.get(1)?,
        domain: row.get(2)?,
        uri: row.get(3)?,
        statement: row.get(4)?,
        nonce: row.get(5)?,
        issued_at: row.get(6)?,
        expiration_time: row.get(7)?,
        network: row.get(8)?,
        expires_at: as_u64(row.get(9)?)?,
        consumed_at: row.get::<_, Option<i64>>(10)?.map(as_u64).transpose()?,
    })
}

fn siwx_message(payload: &SiwxPayload) -> Result<String, StoreError> {
    let chain_reference = payload
        .chain_id
        .strip_prefix("solana:")
        .ok_or_else(|| StoreError::Unauthorized("wallet SIWX chain is not Solana".to_owned()))?;
    let mut lines = vec![
        format!(
            "{} wants you to sign in with your Solana account:",
            payload.domain
        ),
        payload.address.clone(),
        String::new(),
    ];
    if let Some(statement) = &payload.statement {
        lines.push(statement.clone());
        lines.push(String::new());
    }
    lines.push(format!("URI: {}", payload.uri));
    lines.push(format!("Version: {}", payload.version));
    lines.push(format!("Chain ID: {chain_reference}"));
    lines.push(format!("Nonce: {}", payload.nonce));
    lines.push(format!("Issued At: {}", payload.issued_at));
    if let Some(expiration_time) = &payload.expiration_time {
        lines.push(format!("Expiration Time: {expiration_time}"));
    }
    if let Some(not_before) = &payload.not_before {
        lines.push(format!("Not Before: {not_before}"));
    }
    if let Some(request_id) = &payload.request_id {
        lines.push(format!("Request ID: {request_id}"));
    }
    if let Some(resources) = &payload.resources
        && !resources.is_empty()
    {
        lines.push("Resources:".to_owned());
        lines.extend(resources.iter().map(|resource| format!("- {resource}")));
    }
    Ok(lines.join("\n"))
}

fn shelf_starter_from_row(row: &db::Row) -> db::Result<ShelfStarter> {
    Ok(ShelfStarter {
        id: row.get(0)?,
        prompt: row.get(1)?,
        rationale: row.get(2)?,
        category: row.get(3)?,
        source: "ai_interview_prompt",
        buyer_waiting: false,
        guaranteed_reward_krw: 0,
        generated_at: as_u64(row.get(4)?)?,
        expires_at: as_u64(row.get(5)?)?,
    })
}

fn load_profile(connection: &Connection, user_id: &str) -> Result<Option<UserProfile>, StoreError> {
    Ok(connection
        .query_row(
            "SELECT p.handle, p.age_band, p.region, p.household, p.field, p.years,
                    p.speaks_to_json, p.wallet, p.wallet_verified_at, p.agreed_at,
                    p.auto_match, p.agents, p.consent_version,
                    p.browser_alerts, p.email_alerts,
                    (SELECT COUNT(*) FROM memory_entries m
                     WHERE m.user_id = p.user_id AND m.status = 'voided'),
                    EXISTS(SELECT 1 FROM dispute_events d WHERE d.user_id = p.user_id)
             FROM profiles p WHERE p.user_id = ?1",
            [user_id],
            profile_from_row,
        )
        .optional()?)
}

fn profile_matches(profile: &UserProfile, filters: &SearchFilters) -> bool {
    filters
        .age_band
        .as_deref()
        .is_none_or(|value| profile.age_band == value)
        && filters
            .region
            .as_deref()
            .is_none_or(|value| profile.region == value)
        && filters
            .household
            .as_deref()
            .is_none_or(|value| profile.household == value)
        && filters
            .field
            .as_deref()
            .is_none_or(|value| profile.field == value)
        && filters
            .category
            .as_deref()
            .is_none_or(|value| profile.speaks_to.iter().any(|field| field == value))
}

fn dispute_from_row(row: &db::Row) -> db::Result<DisputeCase> {
    Ok(DisputeCase {
        memory_id: row.get(0)?,
        user_id: row.get(1)?,
        status: row.get(2)?,
        reason: row.get(3)?,
        review_note: row.get(4)?,
        created_at: as_u64(row.get(5)?)?,
        reviewed_at: row.get::<_, Option<i64>>(6)?.map(as_u64).transpose()?,
    })
}

fn document_feedback_from_row(row: &db::Row) -> db::Result<DocumentFeedback> {
    Ok(DocumentFeedback {
        id: row.get(0)?,
        query_id: row.get(1)?,
        document_handle: row.get(2)?,
        payer: row.get(3)?,
        outcome: row.get(4)?,
        reason: row.get(5)?,
        status: row.get(6)?,
        review_note: row.get(7)?,
        created_at: as_u64(row.get(8)?)?,
        reviewed_at: row.get::<_, Option<i64>>(9)?.map(as_u64).transpose()?,
    })
}

fn recompute_document_reliability(
    transaction: &Transaction<'_>,
    document_id: &str,
) -> Result<(), StoreError> {
    let (positive, negative, upheld_reports) = transaction.query_row(
        "SELECT
           SUM(CASE WHEN outcome = 'helpful' THEN 1 ELSE 0 END),
           SUM(CASE WHEN outcome = 'not_helpful' OR
                         (outcome = 'report' AND status = 'upheld') THEN 1 ELSE 0 END),
           SUM(CASE WHEN outcome = 'report' AND status = 'upheld' THEN 1 ELSE 0 END)
         FROM document_feedback WHERE document_id = ?1",
        [document_id],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(0).max(0) as u64,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0).max(0) as u64,
                row.get::<_, Option<i64>>(2)?.unwrap_or(0).max(0) as u64,
            ))
        },
    )?;
    let prior_weight = 10.0_f64;
    let reliability =
        (prior_weight * 0.8 + positive as f64) / (prior_weight + positive as f64 + negative as f64);
    transaction.execute(
        "UPDATE documents SET reliability_score = ?1,
                locked = CASE WHEN ?2 >= 2 THEN 1 ELSE locked END
         WHERE id = ?3",
        params![reliability, upheld_reports, document_id],
    )?;
    Ok(())
}

fn profile_from_row(row: &db::Row) -> db::Result<UserProfile> {
    let speaks_to_json: String = row.get(6)?;
    let wallet_verified_at = row.get::<_, Option<i64>>(8)?.map(as_u64).transpose()?;
    let strikes = as_usize(row.get(15)?)?;
    let configured_auto_match = row.get::<_, i64>(10)? != 0;
    Ok(UserProfile {
        handle: row.get(0)?,
        age_band: row.get(1)?,
        region: row.get(2)?,
        household: row.get(3)?,
        field: row.get(4)?,
        years: row.get(5)?,
        speaks_to: serde_json::from_str(&speaks_to_json).unwrap_or_default(),
        wallet: row.get(7)?,
        wallet_verified: wallet_verified_at.is_some(),
        wallet_verified_at,
        agreed_at: as_u64(row.get(9)?)?,
        consent_version: row.get(12)?,
        auto_match: configured_auto_match && strikes < AUTO_MATCH_STRIKE_LIMIT,
        agents: row.get::<_, i64>(11)? != 0,
        browser_alerts: row.get::<_, i64>(13)? != 0,
        email_alerts: row.get::<_, i64>(14)? != 0,
        strikes,
        dispute_used: row.get::<_, i64>(16)? != 0,
        suspended: strikes >= STRIKE_LIMIT,
    })
}

fn earning_from_row(row: &db::Row) -> db::Result<EarningEvent> {
    let stored_status: String = row.get(7)?;
    let available_at = as_u64(row.get(8)?)?;
    let payout_status = if stored_status == "held" && available_at <= now_ms() {
        "accrued".to_owned()
    } else {
        stored_status
    };
    Ok(EarningEvent {
        id: row.get(0)?,
        settlement_id: row.get(1)?,
        memory_id: row.get(2)?,
        document_handle: row.get(3)?,
        source: row.get(4)?,
        amount_krw: as_u64(row.get(5)?)?,
        recipient_wallet: row.get(6)?,
        payout_status,
        payout_claim_id: row.get(10)?,
        payout_claim_status: row.get(11)?,
        payout_transaction_signature: row.get(12)?,
        payout_amount_atomic: row
            .get::<_, Option<i64>>(13)?
            .map(as_u64)
            .transpose()?
            .map(|amount| amount.to_string()),
        available_at,
        created_at: as_u64(row.get(9)?)?,
    })
}

fn payout_claim_from_row(row: &db::Row) -> db::Result<PayoutClaim> {
    Ok(PayoutClaim {
        id: row.get(0)?,
        earning_event_id: row.get(1)?,
        open_call_id: row.get(2)?,
        beneficiary_user_id: row.get(3)?,
        kind: row.get(4)?,
        escrow_wallet: row.get(5)?,
        recipient_wallet: row.get(6)?,
        asset: row.get(7)?,
        network: row.get(8)?,
        amount_atomic: as_u64(row.get(9)?)?.to_string(),
        amount_krw: as_u64(row.get(10)?)?,
        status: row.get(11)?,
        transaction_signature: row.get(12)?,
        signed_transaction_base64: row.get(13)?,
        recent_blockhash: row.get(14)?,
        last_valid_block_height: row.get::<_, Option<i64>>(15)?.map(as_u64).transpose()?,
        attempt_count: as_u64(row.get(16)?)?.min(u32::MAX as u64) as u32,
        last_error: row.get(17)?,
        created_at: as_u64(row.get(18)?)?,
        updated_at: as_u64(row.get(19)?)?,
        confirmed_at: row.get::<_, Option<i64>>(20)?.map(as_u64).transpose()?,
    })
}

fn load_payout_claim(connection: &Connection, claim_id: &str) -> Result<PayoutClaim, StoreError> {
    connection
        .query_row(
            "SELECT id, earning_event_id, open_call_id, beneficiary_user_id, kind,
                    escrow_wallet, recipient_wallet, asset, network, amount_atomic,
                    amount_krw, status, transaction_signature, signed_transaction_base64,
                    recent_blockhash, last_valid_block_height, attempt_count, last_error,
                    created_at, updated_at, confirmed_at
             FROM payout_claims WHERE id = ?1",
            [claim_id.trim()],
            payout_claim_from_row,
        )
        .optional()?
        .ok_or(StoreError::NotFound("payout claim"))
}

fn require_active_payout_lease(
    worker_id: &str,
    lease_owner: Option<&str>,
    lease_expires_at: Option<u64>,
    now: u64,
) -> Result<(), StoreError> {
    if lease_owner != Some(worker_id.trim()) || lease_expires_at.is_none_or(|expiry| expiry <= now)
    {
        return Err(StoreError::Conflict(
            "payout claim is not actively leased by this worker".to_owned(),
        ));
    }
    Ok(())
}

fn chain_settlement_from_row(row: &db::Row) -> db::Result<ChainSettlementReceipt> {
    Ok(ChainSettlementReceipt {
        id: row.get(0)?,
        quote_id: row.get(1)?,
        transaction_signature: row.get(2)?,
        payer: row.get(3)?,
        pay_to: row.get(4)?,
        amount_atomic: as_u64(row.get(5)?)?.to_string(),
        network: row.get(6)?,
        confirmed_at: as_u64(row.get(7)?)?,
    })
}

fn ensure_prepaid_account(
    connection: &Connection,
    wallet: &str,
    pay_to: &str,
    network: &str,
    asset: &str,
    now: u64,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT OR IGNORE INTO prepaid_accounts
         (wallet, pay_to, network, asset, available_atomic,
          total_deposited_atomic, updated_at, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5)",
        params![wallet, pay_to, network, asset, as_i64(now)?],
    )?;
    Ok(())
}

fn prepaid_available(
    connection: &Connection,
    wallet: &str,
    pay_to: &str,
    network: &str,
    asset: &str,
) -> Result<u64, StoreError> {
    connection
        .query_row(
            "SELECT available_atomic FROM prepaid_accounts
             WHERE wallet = ?1 AND pay_to = ?2 AND network = ?3 AND asset = ?4",
            params![wallet, pay_to, network, asset],
            |row| as_u64(row.get(0)?),
        )
        .optional()
        .map(|value| value.unwrap_or(0))
        .map_err(StoreError::from)
}

fn require_prepaid_session(
    connection: &Connection,
    token_hash: &str,
    now: u64,
) -> Result<(String, String), StoreError> {
    if token_hash.len() != 64 {
        return Err(StoreError::Unauthorized(
            "prepaid wallet session is missing or invalid".to_owned(),
        ));
    }
    connection
        .query_row(
            "SELECT user_id, wallet FROM prepaid_wallet_sessions
             WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2",
            params![token_hash, as_i64(now)?],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| StoreError::Unauthorized("prepaid wallet session has expired".to_owned()))
}

#[allow(clippy::too_many_arguments)]
fn reserve_prepaid_budget(
    connection: &Connection,
    wallet: &str,
    pay_to: &str,
    network: &str,
    asset: &str,
    job_id: &str,
    amount_atomic: u64,
    now: u64,
) -> Result<(), StoreError> {
    let amount = as_i64(amount_atomic)?;
    let changed = connection.execute(
        "UPDATE prepaid_accounts
         SET available_atomic = available_atomic - ?1, updated_at = ?2
         WHERE wallet = ?3 AND pay_to = ?4 AND network = ?5 AND asset = ?6
           AND available_atomic >= ?1",
        params![amount, as_i64(now)?, wallet, pay_to, network, asset],
    )?;
    if changed != 1 {
        return Err(StoreError::Conflict(
            "prepaid balance changed and no longer covers this research job".to_owned(),
        ));
    }
    let balance = prepaid_available(connection, wallet, pay_to, network, asset)?;
    connection.execute(
        "INSERT INTO prepaid_ledger
         (id, wallet, pay_to, network, asset, kind, reference_id,
          delta_atomic, balance_after_atomic, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'research_reservation', ?6, ?7, ?8, ?9)",
        params![
            new_id("prepaid-ledger"),
            wallet,
            pay_to,
            network,
            asset,
            job_id,
            -amount,
            as_i64(balance)?,
            as_i64(now)?,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn credit_prepaid_deposit(
    connection: &Connection,
    wallet: &str,
    pay_to: &str,
    network: &str,
    asset: &str,
    transaction_signature: &str,
    amount_atomic: u64,
    now: u64,
) -> Result<(), StoreError> {
    ensure_prepaid_account(connection, wallet, pay_to, network, asset, now)?;
    let amount = as_i64(amount_atomic)?;
    connection.execute(
        "UPDATE prepaid_accounts
         SET available_atomic = available_atomic + ?1,
             total_deposited_atomic = total_deposited_atomic + ?1,
             updated_at = ?2
         WHERE wallet = ?3 AND pay_to = ?4 AND network = ?5 AND asset = ?6",
        params![amount, as_i64(now)?, wallet, pay_to, network, asset],
    )?;
    let balance = prepaid_available(connection, wallet, pay_to, network, asset)?;
    connection.execute(
        "INSERT INTO prepaid_ledger
         (id, wallet, pay_to, network, asset, kind, reference_id,
          delta_atomic, balance_after_atomic, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deposit', ?6, ?7, ?8, ?9)",
        params![
            new_id("prepaid-ledger"),
            wallet,
            pay_to,
            network,
            asset,
            transaction_signature,
            amount,
            as_i64(balance)?,
            as_i64(now)?,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn release_prepaid_budget(
    connection: &Connection,
    wallet: &str,
    pay_to: &str,
    network: &str,
    asset: &str,
    job_id: &str,
    amount_atomic: u64,
    now: u64,
) -> Result<(), StoreError> {
    let amount = as_i64(amount_atomic)?;
    let changed = connection.execute(
        "UPDATE prepaid_accounts
         SET available_atomic = available_atomic + ?1, updated_at = ?2
         WHERE wallet = ?3 AND pay_to = ?4 AND network = ?5 AND asset = ?6",
        params![amount, as_i64(now)?, wallet, pay_to, network, asset],
    )?;
    if changed != 1 {
        return Err(StoreError::Conflict(
            "prepaid account no longer exists".to_owned(),
        ));
    }
    let balance = prepaid_available(connection, wallet, pay_to, network, asset)?;
    connection.execute(
        "INSERT INTO prepaid_ledger
         (id, wallet, pay_to, network, asset, kind, reference_id,
          delta_atomic, balance_after_atomic, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'research_release', ?6, ?7, ?8, ?9)",
        params![
            new_id("prepaid-ledger"),
            wallet,
            pay_to,
            network,
            asset,
            job_id,
            amount,
            as_i64(balance)?,
            as_i64(now)?,
        ],
    )?;
    Ok(())
}

fn load_research_job_status(
    connection: &Connection,
    job_id: &str,
) -> Result<ResearchJobStatus, StoreError> {
    let (
        id,
        query_id,
        payer,
        pay_to,
        network,
        asset,
        amount_atomic,
        status,
        failure_reason,
        created_at,
        funded_at,
        completed_at,
        transaction_signature,
    ) = connection
        .query_row(
            "SELECT pbq.id, pbq.query_id, pbq.payer_wallet, pbq.pay_to, pbq.network,
                    pbq.asset, pbq.amount_atomic, pbq.status, pbq.failure_reason,
                    pbq.created_at, pbq.settled_at, pbq.delivered_at,
                    bcs.transaction_signature
             FROM payment_bundle_quotes pbq
             LEFT JOIN bundle_chain_settlements bcs ON bcs.quote_id = pbq.id
             WHERE pbq.id = ?1",
            [job_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    as_u64(row.get(6)?)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    as_u64(row.get(9)?)?,
                    row.get::<_, Option<i64>>(10)?.map(as_u64).transpose()?,
                    row.get::<_, Option<i64>>(11)?.map(as_u64).transpose()?,
                    row.get::<_, Option<String>>(12)?,
                ))
            },
        )
        .optional()?
        .ok_or(StoreError::NotFound("research job"))?;
    let krw_per_usdc = connection.query_row(
        "SELECT krw_per_usdc FROM payment_bundle_quotes WHERE id = ?1",
        [job_id],
        |row| as_u64(row.get(0)?),
    )?;
    let mut statement = connection.prepare(
        "SELECT pbd.document_handle, pbd.shelf_snapshot, pbd.content_snapshot,
                pbd.price_krw,
                EXISTS(
                    SELECT 1 FROM payment_quotes pq
                    WHERE pq.id = pbd.pay_sh_quote_id AND pq.status = 'delivered'
                ) AS delivered
         FROM payment_bundle_documents pbd
         WHERE pbd.quote_id = ?1 ORDER BY pbd.rank ASC",
    )?;
    let documents = statement
        .query_map([job_id], |row| {
            Ok((
                Citation {
                    handle: row.get(0)?,
                    shelf: row.get(1)?,
                    excerpt: row.get(2)?,
                    price: as_u64(row.get(3)?)?,
                },
                row.get::<_, bool>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut citations = Vec::new();
    let mut pending_handles = Vec::new();
    let mut spent_atomic = 0_u64;
    for (citation, delivered) in documents {
        if delivered {
            spent_atomic = spent_atomic
                .checked_add(krw_to_usdc_atomic(citation.price, krw_per_usdc)?)
                .ok_or_else(|| StoreError::Validation("research job spend overflow".to_owned()))?;
            citations.push(citation);
        } else {
            pending_handles.push(citation.handle);
        }
    }
    Ok(ResearchJobStatus {
        id,
        query_id,
        payer,
        pay_to,
        network,
        asset,
        amount_atomic: amount_atomic.to_string(),
        spent_atomic: spent_atomic.to_string(),
        refundable_atomic: amount_atomic.saturating_sub(spent_atomic).to_string(),
        status,
        transaction_signature,
        failure_reason,
        created_at,
        funded_at,
        completed_at,
        citations,
        pending_handles,
    })
}

fn open_call_funding_quote_from_row(row: &db::Row) -> db::Result<OpenCallFundingQuote> {
    let id: String = row.get(0)?;
    Ok(OpenCallFundingQuote {
        resource_path: format!("/api/v1/funded-open-calls/{id}"),
        id,
        pay_to: row.get(1)?,
        network: row.get(2)?,
        asset: row.get(3)?,
        amount_atomic: as_u64(row.get(4)?)?.to_string(),
        total_price_krw: as_u64(row.get(5)?)?,
        krw_per_usdc: as_u64(row.get(6)?)?,
        expires_at: as_u64(row.get(7)?)?,
        payload_hash: row.get(8)?,
        status: row.get(9)?,
        open_call_id: row.get(10)?,
    })
}

fn is_base58(value: &str) -> bool {
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    !value.is_empty() && value.chars().all(|character| BASE58.contains(character))
}

fn valid_solana_address(value: &str) -> bool {
    (32..=44).contains(&value.len())
        && is_base58(value)
        && bs58::decode(value)
            .into_vec()
            .is_ok_and(|decoded| decoded.len() == 32)
}

#[allow(clippy::too_many_arguments)]
fn insert_earning_event(
    transaction: &Transaction<'_>,
    settlement_id: Option<&str>,
    memory_id: Option<&str>,
    document_id: Option<&str>,
    author_id: &str,
    source: &str,
    amount_krw: u64,
    created_at: u64,
) -> Result<(), StoreError> {
    let recipient_wallet = transaction
        .query_row(
            "SELECT wallet FROM profiles WHERE user_id = ?1",
            [author_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let strikes = transaction.query_row(
        "SELECT COUNT(*) FROM memory_entries WHERE user_id = ?1 AND status = 'voided'",
        [author_id],
        |row| as_usize(row.get(0)?),
    )?;
    let held = strikes >= AUTO_MATCH_STRIKE_LIMIT;
    let available_at = if held {
        created_at.saturating_add(PAYOUT_HOLD_MS)
    } else {
        created_at
    };
    transaction.execute(
        "INSERT INTO earning_events
         (id, settlement_id, memory_id, document_id, author_id, source, amount_krw,
          recipient_wallet, payout_status, available_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            new_id("earning"),
            settlement_id,
            memory_id,
            document_id,
            author_id,
            source,
            as_i64(amount_krw)?,
            recipient_wallet,
            if held { "held" } else { "accrued" },
            as_i64(available_at)?,
            as_i64(created_at)?,
        ],
    )?;
    transaction.execute(
        if held {
            "UPDATE balances SET held_krw = held_krw + ?1, updated_at = ?2 WHERE user_id = ?3"
        } else {
            "UPDATE balances SET available_krw = available_krw + ?1, updated_at = ?2 WHERE user_id = ?3"
        },
        params![as_i64(amount_krw)?, as_i64(created_at)?, author_id],
    )?;
    transaction.execute(
        "INSERT INTO funding_events
         (id, user_id, open_call_id, kind, amount_krw, created_at)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
        params![
            new_id("fund"),
            author_id,
            format!("earning_{source}"),
            as_i64(amount_krw)?,
            as_i64(created_at)?,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_onchain_earning_event(
    transaction: &Transaction<'_>,
    settlement_id: &str,
    memory_id: Option<&str>,
    document_id: &str,
    author_id: &str,
    amount_krw: u64,
    recipient_wallet: &str,
    created_at: u64,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO earning_events
         (id, settlement_id, memory_id, document_id, author_id, source, amount_krw,
          recipient_wallet, payout_status, available_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'document_open', ?6, ?7, 'onchain', ?8, ?8)",
        params![
            new_id("earning"),
            settlement_id,
            memory_id,
            document_id,
            author_id,
            as_i64(amount_krw)?,
            recipient_wallet,
            as_i64(created_at)?,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_open_call_onchain_earning_event(
    connection: &Connection,
    memory_id: Option<&str>,
    document_id: Option<&str>,
    author_id: &str,
    amount_krw: u64,
    recipient_wallet: &str,
    created_at: u64,
) -> Result<String, StoreError> {
    let earning_id = new_id("earning");
    connection.execute(
        "INSERT INTO earning_events
         (id, settlement_id, memory_id, document_id, author_id, source, amount_krw,
          recipient_wallet, payout_status, available_at, created_at)
         VALUES (?1, NULL, ?2, ?3, ?4, 'open_call_onchain', ?5, ?6,
                 'claimable', ?7, ?7)",
        params![
            earning_id,
            memory_id,
            document_id,
            author_id,
            as_i64(amount_krw)?,
            recipient_wallet,
            as_i64(created_at)?,
        ],
    )?;
    Ok(earning_id)
}

fn open_call_answer_atomic(call: &StoredCall) -> Result<u64, StoreError> {
    let total = call.escrow_total_atomic.ok_or_else(|| {
        StoreError::Conflict("funded call has no on-chain escrow total".to_owned())
    })?;
    if call.target == 0 {
        return Err(StoreError::Conflict(
            "funded call has an invalid answer target".to_owned(),
        ));
    }
    let target = u64::try_from(call.target)
        .map_err(|_| StoreError::Conflict("funded call target is too large".to_owned()))?;
    let ordinal = u64::try_from(call.answered)
        .map_err(|_| StoreError::Conflict("funded call answer count is too large".to_owned()))?;
    let amount = total / target + u64::from(ordinal < total % target);
    if amount == 0
        || call
            .escrow_remaining_atomic
            .is_none_or(|remaining| remaining < amount)
    {
        return Err(StoreError::Conflict(
            "open-call on-chain escrow is exhausted".to_owned(),
        ));
    }
    Ok(amount)
}

#[allow(clippy::too_many_arguments)]
fn insert_payout_claim(
    connection: &Connection,
    earning_event_id: Option<&str>,
    open_call_id: Option<&str>,
    beneficiary_user_id: &str,
    kind: &str,
    escrow_wallet: &str,
    recipient_wallet: &str,
    asset: &str,
    network: &str,
    amount_atomic: u64,
    amount_krw: u64,
    created_at: u64,
) -> Result<String, StoreError> {
    if amount_atomic == 0 {
        return Err(StoreError::Validation(
            "payout claim amount must be greater than zero".to_owned(),
        ));
    }
    if !valid_solana_address(escrow_wallet) || !valid_solana_address(recipient_wallet) {
        return Err(StoreError::Validation(
            "payout claim wallets must be valid Solana addresses".to_owned(),
        ));
    }
    let id = new_id("payout");
    connection.execute(
        "INSERT INTO payout_claims
         (id, earning_event_id, open_call_id, beneficiary_user_id, kind,
          escrow_wallet, recipient_wallet, asset, network, amount_atomic, amount_krw,
          status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?12)",
        params![
            id,
            earning_event_id,
            open_call_id,
            beneficiary_user_id,
            kind,
            escrow_wallet,
            recipient_wallet,
            asset,
            network,
            as_i64(amount_atomic)?,
            as_i64(amount_krw)?,
            as_i64(created_at)?,
        ],
    )?;
    Ok(id)
}

fn allocate_atomic_by_weight(total_atomic: u64, weights: &[u64]) -> Result<Vec<u64>, StoreError> {
    if total_atomic == 0 || weights.is_empty() || weights.contains(&0) {
        return Err(StoreError::Validation(
            "payout allocation requires a positive total and positive weights".to_owned(),
        ));
    }
    let total_weight = weights
        .iter()
        .try_fold(0_u128, |sum, weight| sum.checked_add(*weight as u128))
        .ok_or_else(|| StoreError::Validation("payout weights are too large".to_owned()))?;
    let mut allocated = weights
        .iter()
        .map(|weight| ((total_atomic as u128 * *weight as u128) / total_weight) as u64)
        .collect::<Vec<_>>();
    let floor_total = allocated.iter().try_fold(0_u64, |sum, amount| {
        sum.checked_add(*amount)
            .ok_or_else(|| StoreError::Validation("payout allocation overflow".to_owned()))
    })?;
    let mut remainder = total_atomic.saturating_sub(floor_total);
    for amount in &mut allocated {
        if remainder == 0 {
            break;
        }
        *amount = amount.saturating_add(1);
        remainder -= 1;
    }
    if allocated.contains(&0) {
        return Err(StoreError::Validation(
            "payment is too small to create one atomic payout per beneficiary".to_owned(),
        ));
    }
    Ok(allocated)
}

fn backfill_bundle_payout_claims(connection: &Connection) -> Result<(), StoreError> {
    #[allow(clippy::type_complexity)]
    let rows = {
        let mut statement = connection.prepare(
            "SELECT e.id, e.settlement_id, e.author_id, e.recipient_wallet, e.amount_krw,
                    bcs.pay_to, pbq.asset, bcs.network, bcs.amount_atomic, e.created_at
             FROM earning_events e
             JOIN bundle_chain_settlements bcs ON bcs.settlement_id = e.settlement_id
             JOIN payment_bundle_quotes pbq ON pbq.id = bcs.quote_id
             WHERE e.payout_status = 'claimable'
               AND e.recipient_wallet IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM payout_claims pc WHERE pc.earning_event_id = e.id
               )
             ORDER BY e.settlement_id, e.created_at, e.id",
        )?;
        statement
            .query_map(params![], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    as_u64(row.get(4)?)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    as_u64(row.get(8)?)?,
                    as_u64(row.get(9)?)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };

    let mut start = 0;
    while start < rows.len() {
        let settlement_id = &rows[start].1;
        let mut end = start + 1;
        while end < rows.len() && rows[end].1 == *settlement_id {
            end += 1;
        }
        let allocations = allocate_atomic_by_weight(
            rows[start].8,
            &rows[start..end].iter().map(|row| row.4).collect::<Vec<_>>(),
        )?;
        for (row, amount_atomic) in rows[start..end].iter().zip(allocations) {
            insert_payout_claim(
                connection,
                Some(&row.0),
                None,
                &row.2,
                "document_bundle",
                &row.5,
                &row.3,
                &row.6,
                &row.7,
                amount_atomic,
                row.4,
                row.9,
            )?;
        }
        start = end;
    }
    Ok(())
}

fn validate_open_call(request: &CreateOpenCallRequest) -> Result<(), StoreError> {
    let question_length = request.question.trim().chars().count();
    if !(8..=1000).contains(&question_length) {
        return Err(StoreError::Validation(
            "question must be between 8 and 1000 characters".to_owned(),
        ));
    }
    if !(1..=100).contains(&request.target) {
        return Err(StoreError::Validation(
            "target must be between 1 and 100".to_owned(),
        ));
    }
    if request.unit_price > 10_000_000 {
        return Err(StoreError::Validation(
            "unitPrice must be at most 10000000 KRW".to_owned(),
        ));
    }
    if request.shelf.trim().is_empty() || request.shelf.trim().chars().count() > 120 {
        return Err(StoreError::Validation(
            "shelf must be between 1 and 120 characters".to_owned(),
        ));
    }
    if !CATEGORY_IDS.contains(&request.category.trim()) {
        return Err(StoreError::Validation("unsupported category".to_owned()));
    }
    validate_filters(&request.filters)?;
    Ok(())
}

fn validate_interview_responses(
    responses: &[InterviewResponse],
) -> Result<Vec<InterviewResponse>, StoreError> {
    if responses.len() > 8 {
        return Err(StoreError::Validation(
            "interview responses must contain 8 turns or fewer".to_owned(),
        ));
    }

    let mut question_ids = HashSet::new();
    responses
        .iter()
        .map(|response| {
            let question_id = response.question_id.trim();
            let prompt = response.prompt.trim();
            let answer = response.answer.trim();
            if question_id.is_empty() || question_id.chars().count() > 64 {
                return Err(StoreError::Validation(
                    "interview question id must be between 1 and 64 characters".to_owned(),
                ));
            }
            if !question_ids.insert(question_id.to_owned()) {
                return Err(StoreError::Validation(
                    "interview question ids must be unique".to_owned(),
                ));
            }
            if prompt.is_empty() || prompt.chars().count() > 500 {
                return Err(StoreError::Validation(
                    "interview prompt must be between 1 and 500 characters".to_owned(),
                ));
            }
            if answer.is_empty() || answer.chars().count() > 2_000 {
                return Err(StoreError::Validation(
                    "interview answer must be between 1 and 2000 characters".to_owned(),
                ));
            }
            Ok(InterviewResponse {
                question_id: question_id.to_owned(),
                prompt: prompt.to_owned(),
                answer: answer.to_owned(),
            })
        })
        .collect()
}

fn load_call(transaction: &Transaction<'_>, id: &str) -> Result<StoredCall, StoreError> {
    transaction
        .query_row(
            "SELECT id, owner_id, question, unit_price_krw, target, answered,
                    created_at, chat_id, shelf, category, target_age_band,
                    target_region, target_household, target_field,
                    escrow_remaining_krw, status, escrow_mode, escrow_wallet,
                    escrow_asset, escrow_network, escrow_total_atomic,
                    escrow_remaining_atomic, funding_transaction_signature, payer_wallet
             FROM open_calls WHERE id = ?1",
            [id],
            stored_call_from_row,
        )
        .optional()?
        .ok_or(StoreError::NotFound("open call"))
}

fn stored_call_from_row(row: &db::Row) -> db::Result<StoredCall> {
    Ok(StoredCall {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        question: row.get(2)?,
        unit_price: as_u64(row.get(3)?)?,
        target: as_usize(row.get(4)?)?,
        answered: as_usize(row.get(5)?)?,
        created_at: as_u64(row.get(6)?)?,
        chat_id: row.get(7)?,
        shelf: row.get(8)?,
        category: row.get(9)?,
        filters: SearchFilters {
            category: Some(row.get(9)?),
            max_unit_price_krw: None,
            age_band: row.get(10)?,
            region: row.get(11)?,
            household: row.get(12)?,
            field: row.get(13)?,
        },
        escrow_remaining_krw: as_u64(row.get(14)?)?,
        status: row.get(15)?,
        escrow_mode: row.get(16)?,
        escrow_wallet: row.get(17)?,
        escrow_asset: row.get(18)?,
        escrow_network: row.get(19)?,
        escrow_total_atomic: row.get::<_, Option<i64>>(20)?.map(as_u64).transpose()?,
        escrow_remaining_atomic: row.get::<_, Option<i64>>(21)?.map(as_u64).transpose()?,
        funding_transaction_signature: row.get(22)?,
        payer_wallet: row.get(23)?,
    })
}

fn memory_from_row(row: &db::Row) -> db::Result<MemoryEntry> {
    let flags_json: String = row.get(8)?;
    let interview_json: String = row.get(11)?;
    Ok(MemoryEntry {
        id: row.get(0)?,
        question: row.get(1)?,
        answer: row.get(2)?,
        shelf: row.get(3)?,
        earned: as_u64(row.get(4)?)?,
        created_at: as_u64(row.get(5)?)?,
        via: row.get(6)?,
        status: row.get(7)?,
        flags: serde_json::from_str(&flags_json).unwrap_or_default(),
        rating: row.get(9)?,
        dispute_status: row.get(10)?,
        interview_responses: serde_json::from_str(&interview_json).unwrap_or_default(),
        memory_type: row.get(12)?,
        importance: row.get(13)?,
        reliability_score: row.get(14)?,
        content_hash: row.get(15)?,
        version: as_u64(row.get(16)?)?.min(u32::MAX as u64) as u32,
        locked: row.get::<_, i64>(17)? != 0,
        access_count: as_u64(row.get(18)?)?,
        last_accessed_at: row.get::<_, Option<i64>>(19)?.map(as_u64).transpose()?,
        source_ids: serde_json::from_str(&row.get::<_, String>(20)?).unwrap_or_default(),
    })
}

fn document_from_row(row: &db::Row) -> db::Result<Document> {
    let created_at = as_u64(row.get(9)?)?;
    let age_days = now_ms().saturating_sub(created_at) / 86_400_000;
    let tags_json: String = row.get(7)?;
    let age_band = row.get::<_, Option<String>>(13)?;
    let region = row.get::<_, Option<String>>(14)?;
    let household = row.get::<_, Option<String>>(15)?;
    let field = row.get::<_, Option<String>>(16)?;
    Ok(Document {
        id: row.get(0)?,
        handle: row.get(1)?,
        author_id: row.get(2)?,
        shelf_id: row.get(3)?,
        shelf: row.get(4)?,
        category: row.get(5)?,
        content: row.get(6)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        price_krw: as_u64(row.get(8)?)?,
        age_days: age_days.min(u32::MAX as u64) as u32,
        quality_score: row.get(10)?,
        reliability_score: row.get(11)?,
        locked: row.get::<_, i64>(12)? != 0,
        demographics: age_band.map(|age_band| DemographicBands {
            age_band,
            region: region.unwrap_or_default(),
            household: household.unwrap_or_default(),
            field: field.unwrap_or_default(),
        }),
    })
}

fn insert_document(
    transaction: &Transaction<'_>,
    document: &Document,
    created_at: u64,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT OR IGNORE INTO documents
         (id, handle, author_id, shelf_id, shelf, category, content, tags_json,
          price_krw, created_at, quality_score, reliability_score, locked, content_hash, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1)",
        params![
            document.id,
            document.handle,
            document.author_id,
            document.shelf_id,
            document.shelf,
            document.category,
            document.content,
            serde_json::to_string(&document.tags).expect("tags are serialisable"),
            as_i64(document.price_krw)?,
            as_i64(created_at)?,
            document.quality_score,
            document.reliability_score,
            i64::from(document.locked),
            sha256_hex(&document.content),
        ],
    )?;
    Ok(())
}

fn backfill_content_hashes(connection: &Connection) -> Result<(), StoreError> {
    let documents = {
        let mut statement =
            connection.prepare("SELECT id, content FROM documents WHERE content_hash = ''")?;
        statement
            .query_map(params![], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (id, content) in documents {
        connection.execute(
            "UPDATE documents SET content_hash = ?1 WHERE id = ?2",
            params![sha256_hex(&content), id],
        )?;
    }

    let memories = {
        let mut statement =
            connection.prepare("SELECT id, answer FROM memory_entries WHERE content_hash = ''")?;
        statement
            .query_map(params![], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (id, answer) in memories {
        connection.execute(
            "UPDATE memory_entries SET content_hash = ?1 WHERE id = ?2",
            params![sha256_hex(&answer), id],
        )?;
    }
    Ok(())
}

fn maybe_create_reflection(
    transaction: &Transaction<'_>,
    user_id: &str,
    created_at: u64,
    reliability: f32,
) -> Result<(), StoreError> {
    let observation_count = transaction.query_row(
        "SELECT COUNT(*) FROM memory_entries
         WHERE user_id = ?1 AND status = 'settled' AND memory_type = 'observation'",
        [user_id],
        |row| as_usize(row.get(0)?),
    )?;
    if observation_count < 3 || observation_count % 3 != 0 {
        return Ok(());
    }
    let sources = {
        let mut statement = transaction.prepare(
            "SELECT id, question, answer FROM memory_entries
             WHERE user_id = ?1 AND status = 'settled' AND memory_type = 'observation'
             ORDER BY created_at DESC LIMIT 3",
        )?;
        statement
            .query_map([user_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let source_ids = sources
        .iter()
        .map(|source| source.0.clone())
        .collect::<Vec<_>>();
    let summary = sources
        .iter()
        .map(|(_, question, answer)| {
            let excerpt = answer.chars().take(180).collect::<String>();
            format!("{question}: {excerpt}")
        })
        .collect::<Vec<_>>()
        .join(" | ");
    transaction.execute(
        "INSERT INTO memory_entries
         (id, user_id, question, answer, shelf, earned_krw, created_at, via, status,
          flags_json, interview_json, memory_type, importance, source_ids_json,
          content_hash, reliability_score)
         VALUES (?1, ?2, 'What patterns connect my recent experiences?', ?3,
                 'Contributor reflection', 0, ?4, 'Reflection', 'settled', '[]', '[]',
                 'reflection', 0.8, ?5, ?6, ?7)",
        params![
            new_id("reflection"),
            user_id,
            summary,
            as_i64(created_at.saturating_add(1))?,
            serde_json::to_string(&source_ids).expect("source ids are serialisable"),
            sha256_hex(&summary),
            reliability,
        ],
    )?;
    Ok(())
}

fn author_reliability(transaction: &Transaction<'_>, user_id: &str) -> Result<f32, StoreError> {
    let (accepted, voided, average_rating) = transaction.query_row(
        "SELECT
             SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END),
             SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END),
             CAST(AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS REAL)
         FROM memory_entries WHERE user_id = ?1 AND memory_type = 'observation'",
        [user_id],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(0) as f32,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0) as f32,
                row.get::<_, Option<f32>>(2)?,
            ))
        },
    )?;
    let behavioral = (accepted + 2.0) / (accepted + voided + 4.0);
    let rating = average_rating.map(|value| value / 5.0).unwrap_or(0.5);
    Ok((behavioral * 0.75 + rating * 0.25).clamp(0.05, 0.98))
}

fn author_reliability_readonly(connection: &Connection, user_id: &str) -> Result<f32, StoreError> {
    let (accepted, voided, average_rating) = connection.query_row(
        "SELECT
             SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END),
             SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END),
             CAST(AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS REAL)
         FROM memory_entries WHERE user_id = ?1 AND memory_type = 'observation'",
        [user_id],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(0) as f32,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0) as f32,
                row.get::<_, Option<f32>>(2)?,
            ))
        },
    )?;
    let behavioral = (accepted + 2.0) / (accepted + voided + 4.0);
    let rating = average_rating.map(|value| value / 5.0).unwrap_or(0.5);
    Ok((behavioral * 0.75 + rating * 0.25).clamp(0.05, 0.98))
}

fn memory_importance(
    question: &str,
    answer: &str,
    interview_responses: &[InterviewResponse],
) -> f32 {
    let detail = (answer.chars().count() as f32 / 600.0).min(1.0);
    let specificity = if answer.chars().any(|character| character.is_ascii_digit()) {
        1.0
    } else {
        0.4
    };
    let interview_depth = (interview_responses.len() as f32 / 4.0).min(1.0);
    let question_depth = (question.split_whitespace().count() as f32 / 12.0).min(1.0);
    (0.2 + detail * 0.3 + specificity * 0.2 + interview_depth * 0.2 + question_depth * 0.1)
        .clamp(0.0, 1.0)
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_digest(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_payment_policy(policy: &PaymentQuotePolicy) -> Result<(), StoreError> {
    if policy.krw_per_usdc == 0 {
        return Err(StoreError::Validation(
            "krwPerUsdc must be greater than zero".to_owned(),
        ));
    }
    if !(30_000..=86_400_000).contains(&policy.ttl_ms) {
        return Err(StoreError::Validation(
            "payment quote ttl must be between 30 seconds and 24 hours".to_owned(),
        ));
    }
    if policy.network.trim().is_empty() || policy.asset.trim().is_empty() {
        return Err(StoreError::Validation(
            "payment network and asset are required".to_owned(),
        ));
    }
    Ok(())
}

fn krw_to_usdc_atomic(amount_krw: u64, krw_per_usdc: u64) -> Result<u64, StoreError> {
    if krw_per_usdc == 0 {
        return Err(StoreError::Validation(
            "krwPerUsdc must be greater than zero".to_owned(),
        ));
    }
    let numerator = u128::from(amount_krw)
        .checked_mul(USDC_ATOMIC_UNITS)
        .ok_or_else(|| StoreError::Validation("payment amount is too large".to_owned()))?;
    let denominator = u128::from(krw_per_usdc);
    let atomic = numerator.div_ceil(denominator).max(1);
    u64::try_from(atomic)
        .map_err(|_| StoreError::Validation("payment amount is too large".to_owned()))
}

fn validate_chain_settlement_request(
    request: &RecordChainSettlementRequest,
) -> Result<(), StoreError> {
    let signature = request.transaction_signature.trim();
    if !(64..=128).contains(&signature.len()) || !is_base58(signature) {
        return Err(StoreError::Validation(
            "transactionSignature must be a base58 Solana signature".to_owned(),
        ));
    }
    if !valid_solana_address(request.payer.trim()) || !valid_solana_address(request.pay_to.trim()) {
        return Err(StoreError::Validation(
            "payer and payTo must be base58 Solana public keys".to_owned(),
        ));
    }
    Ok(())
}

fn settlement_raw_json(request: &RecordChainSettlementRequest) -> Result<String, StoreError> {
    let raw_response_json = serde_json::to_string(&request.raw_response)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    if raw_response_json.len() > 32_768 {
        return Err(StoreError::Validation(
            "rawResponse must be at most 32768 bytes".to_owned(),
        ));
    }
    Ok(raw_response_json)
}

fn seed_evidence_edges(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let edges = [
        (
            "edge_seongsu_lunch",
            "md_lunch_12",
            "md_seongsu_11",
            "corroborates",
            "seongsu.food",
            0.9_f32,
        ),
        (
            "edge_seongsu_route",
            "md_seongsu_12",
            "md_seongsu_13",
            "contextualizes",
            "seongsu.mobility",
            0.7_f32,
        ),
        (
            "edge_paris_life",
            "md_paris_11",
            "md_paris_12",
            "contextualizes",
            "paris.food",
            0.7_f32,
        ),
        (
            "edge_wallet_separation",
            "md_wallet_12",
            "md_wallet_11",
            "corroborates",
            "solana.wallet-security",
            0.95_f32,
        ),
        (
            "edge_backend_production",
            "md_backend_12",
            "md_backend_11",
            "contextualizes",
            "engineering.production",
            0.65_f32,
        ),
    ];
    let created_at = now_ms();
    for (id, source, target, relation, topic, weight) in edges {
        transaction.execute(
            "INSERT OR IGNORE INTO evidence_edges
             (id, source_document_id, target_document_id, relation, provenance,
              topic, weight, actor, created_at)
             VALUES (?1, ?2, ?3, ?4, 'admin_verified', ?5, ?6, 'seed-curator-v1', ?7)",
            params![
                id,
                source,
                target,
                relation,
                topic,
                weight,
                as_i64(created_at)?,
            ],
        )?;
    }
    Ok(())
}

fn seed_open_calls(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let seeds = [
        (
            "call_seed_1",
            "life",
            "Seongsu daily life",
            "Weekday lunch in Seongsu with no queue and under 15 minutes — where do you actually go?",
            300,
            7,
            4,
            1,
        ),
        (
            "call_seed_2",
            "family",
            "Primary school parents",
            "Getting a kid ready for first grade — what actually cost the most? Especially what you did not see coming.",
            500,
            12,
            9,
            5,
        ),
        (
            "call_seed_3",
            "business",
            "Small shop owners",
            "If you have run a shop for 3+ years: setting delivery-app fees aside, what actually ate your margin?",
            800,
            10,
            2,
            26,
        ),
        (
            "call_seed_4",
            "travel",
            "Living in Paris",
            "Lived in Paris a year or more: a dinner spot tourists never reach that you go back to.",
            400,
            8,
            3,
            50,
        ),
        (
            "call_seed_5",
            "engineering",
            "Small-team infra",
            "You carry the pager for a team under ten. What wakes you up, and what did you automate away?",
            900,
            6,
            1,
            2,
        ),
    ];
    for (id, category, shelf, question, price, target, answered, aged_hours) in seeds {
        transaction.execute(
            "INSERT OR IGNORE INTO open_calls
             (id, owner_id, question, unit_price_krw, target, answered, created_at,
              chat_id, shelf, category, status, escrow_remaining_krw)
             VALUES (?1, 'seed-buyer', ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, 'open', ?9)",
            params![
                id,
                question,
                price,
                target,
                answered,
                as_i64(now_ms().saturating_sub(aged_hours * 3_600_000))?,
                shelf,
                category,
                price * (target - answered),
            ],
        )?;
    }
    Ok(())
}

fn seed_memory(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let seeds = [
        (
            "memory_seed_1",
            "Weekday lunch in Seongsu without the queue",
            "Yeonmujang-gil backs up after 12, so I leave at 11:40 or walk toward Seoul Forest instead. Only two noodle places get you out in 15 minutes.",
            "Seongsu daily life",
            300,
            3,
        ),
        (
            "memory_seed_2",
            "Fixed costs nobody warns you about when running a cafe",
            "Cleaning supplies and consumables cost more than the beans. Cups, sleeves, and the water filter add up to about 1.4x the bean cost per month.",
            "Small shop owners",
            800,
            20,
        ),
        (
            "memory_seed_3",
            "When to do the weekday grocery run",
            "Stopping by after work means the fresh section is picked over, so I order in the morning and collect in the evening. Pickup saves about 30 minutes.",
            "Weekday routines",
            250,
            46,
        ),
    ];
    for (id, question, answer, shelf, earned, aged_hours) in seeds {
        let created_at = now_ms().saturating_sub(aged_hours * 3_600_000);
        transaction.execute(
            "INSERT OR IGNORE INTO memory_entries
             (id, user_id, question, answer, shelf, earned_krw, created_at, via,
              status, flags_json, rating)
             VALUES (?1, 'demo-user', ?2, ?3, ?4, ?5, ?6, 'Auto-match', 'settled', '[]', 5)",
            params![id, question, answer, shelf, earned, as_i64(created_at)?,],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO earning_events
             (id, memory_id, author_id, source, amount_krw, payout_status,
              available_at, created_at)
             VALUES (?1, ?2, 'demo-user', 'seed', ?3, 'accrued', ?4, ?4)",
            params![
                id.replace("memory_", "earning_"),
                id,
                earned,
                as_i64(created_at)?,
            ],
        )?;
    }
    Ok(())
}

fn new_id(prefix: &str) -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{:x}_{counter:x}", now_ms())
}

fn handle_from_id(id: &str) -> String {
    format!("MD{}", &sha256_hex(id)[..10]).to_uppercase()
}

fn slug(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is before the Unix epoch")
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn as_i64(value: u64) -> Result<i64, StoreError> {
    i64::try_from(value)
        .map_err(|_| StoreError::Validation("numeric value is too large".to_owned()))
}

fn as_u64(value: i64) -> db::Result<u64> {
    u64::try_from(value).map_err(|error| db::Error::Conversion(error.to_string()))
}

fn as_usize(value: i64) -> db::Result<usize> {
    usize::try_from(value).map_err(|error| db::Error::Conversion(error.to_string()))
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    if !connection.column_exists(table, column)? {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition};"
        ))?;
    }
    Ok(())
}

fn valid_email(email: &str) -> bool {
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    !local.is_empty()
        && local.len() <= 64
        && domain.len() <= 255
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && parts.next().is_none()
        && !email.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use ed25519_dalek::{Signer, SigningKey};

    use crate::{
        domain::{
            AiBaselineDraft, CorrectMemoryRequest, CreateEvidenceEdgeRequest,
            CreateOpenCallRequest, CreatePaymentBundleRequest, Decision, EvidenceContribution,
            InterviewResponse, LiquidityState, RecordChainSettlementRequest,
            ResolveQuestionRequest, ReviewDisputeRequest, ReviewDocumentFeedbackRequest,
            SearchFilters, ShelfStarterDraft, SiwxPayload, SubmitAnswerResponse,
            SubmitDocumentFeedbackRequest, UpdatePreferencesRequest, UpsertProfileRequest,
        },
        params,
        search::Resolver,
    };

    use super::{
        AiArtifactMetadata, LOGIN_FAILURE_LIMIT, PayShDeliveryRequest, PaymentQuotePolicy, Store,
        StoreError, now_ms, siwx_message,
    };

    fn create_svalbard_call(store: &Store, owner: &str, target: usize) -> crate::domain::OpenCall {
        ensure_user(store, owner);
        store
            .create_open_call(
                owner,
                &CreateOpenCallRequest {
                    question: "Which winter boots work for field research in Svalbard?".to_owned(),
                    unit_price: 700,
                    target,
                    chat_id: None,
                    shelf: "Svalbard field researchers".to_owned(),
                    category: "travel".to_owned(),
                    filters: SearchFilters::default(),
                },
            )
            .unwrap()
    }

    fn strong_answer() -> &'static str {
        "In January 2025 at Longyearbyen I wore insulated Baffin boots rated to -40C. After 6 hours on packed snow my toes stayed warm, but I changed the felt liner every second day because condensation froze overnight."
    }

    fn profile_request(handle: &str) -> UpsertProfileRequest {
        UpsertProfileRequest {
            handle: handle.to_owned(),
            age_band: "35-44".to_owned(),
            region: "seoul".to_owned(),
            household: "kids".to_owned(),
            field: "engineering".to_owned(),
            years: "7-plus".to_owned(),
            speaks_to: vec![
                "engineering".to_owned(),
                "life".to_owned(),
                "travel".to_owned(),
            ],
            wallet: Some("11111111111111111111111111111111".to_owned()),
            auto_match: true,
            agents: false,
            browser_alerts: true,
            email_alerts: false,
        }
    }

    fn ensure_user(store: &Store, user_id: &str) {
        store.provision_user_for_test(user_id).unwrap();
    }

    fn onboard(store: &Store, user_id: &str) {
        ensure_user(store, user_id);
        if store.get_profile(user_id).unwrap().is_some() {
            return;
        }
        let mut handle = format!(
            "U_{}",
            user_id
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() {
                        character
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        );
        handle.truncate(32);
        store
            .upsert_profile(user_id, &profile_request(&handle))
            .unwrap();
    }

    fn verify_wallet(store: &Store, user_id: &str, secret: u8) -> String {
        let signing_key = SigningKey::from_bytes(&[secret; 32]);
        let wallet = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let challenge = store
            .create_wallet_challenge(user_id, &wallet, &"ab".repeat(32), 300_000)
            .unwrap();
        let signature = signing_key.sign(challenge.message.as_bytes());
        let verified = store
            .verify_wallet_challenge(
                user_id,
                &challenge.id,
                &bs58::encode(signature.to_bytes()).into_string(),
            )
            .unwrap();
        assert!(verified.wallet_verified);
        assert_eq!(verified.wallet.as_deref(), Some(wallet.as_str()));
        wallet
    }

    fn submit(
        store: &Store,
        call_id: &str,
        user_id: &str,
        answer: &str,
    ) -> Result<SubmitAnswerResponse, StoreError> {
        onboard(store, user_id);
        store.submit_answer(call_id, user_id, answer)
    }

    #[test]
    fn pay_sh_resource_is_quote_bound_recoverable_and_idempotent() {
        let store = Store::in_memory().unwrap();
        let question = "Where do people who live in Seongsu eat lunch on weekdays?";
        let resolved = Resolver::new(store.documents().unwrap())
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        let payment_token_hash = "e".repeat(64);
        store
            .record_resolution(question, &resolved, Some(&payment_token_hash))
            .unwrap();
        let handle = resolved.matches[0].handle.clone();
        let receiver = bs58::encode(SigningKey::from_bytes(&[29; 32]).verifying_key().as_bytes())
            .into_string();
        let policy = PaymentQuotePolicy {
            fallback_recipient: Some(receiver.clone()),
            bundle_recipient: Some(receiver.clone()),
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };

        assert!(matches!(
            store.pay_sh_resource(&resolved.query_id, &handle, &"f".repeat(64), &policy),
            Err(StoreError::Unauthorized(_))
        ));
        let resource = store
            .pay_sh_resource(&resolved.query_id, &handle, &payment_token_hash, &policy)
            .unwrap();
        assert_eq!(resource.status, "quoted");
        assert_eq!(resource.recipient_wallet, receiver);
        assert_eq!(
            resource.amount_atomic.parse::<u64>().unwrap(),
            resource.owner_amount_atomic.parse::<u64>().unwrap() + 1
        );
        assert!(resource.resource_path.contains(&resource.quote_id));
        let original = store
            .payment_document_snapshot(&resource.quote_id)
            .unwrap()
            .citation;

        // Payment delivery must use the immutable quoted snapshot even if the
        // live persona document changes between URL preparation and payment.
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE documents SET content = 'changed after quote',
                    content_hash = ?1, version = version + 1 WHERE handle = ?2",
                params!["1".repeat(64), handle],
            )
            .unwrap();
        assert!(matches!(
            store.open_pay_sh_document(PayShDeliveryRequest {
                query_id: &resolved.query_id,
                handle: &handle,
                path_price_krw: resource.price_krw,
                owner_wallet: "11111111111111111111111111111111",
                quote_id: &resource.quote_id,
                payment_token_hash: Some(&payment_token_hash),
                research_job_id: None,
                policy: &policy,
            }),
            Err(StoreError::Validation(_))
        ));
        let delivered = store
            .open_pay_sh_document(PayShDeliveryRequest {
                query_id: &resolved.query_id,
                handle: &handle,
                path_price_krw: resource.price_krw,
                owner_wallet: &resource.recipient_wallet,
                quote_id: &resource.quote_id,
                payment_token_hash: Some(&payment_token_hash),
                research_job_id: None,
                policy: &policy,
            })
            .unwrap();
        assert_eq!(delivered.citations[0].handle, original.handle);
        assert_eq!(delivered.citations[0].excerpt, original.excerpt);
        let replay = store
            .open_pay_sh_document(PayShDeliveryRequest {
                query_id: &resolved.query_id,
                handle: &handle,
                path_price_krw: resource.price_krw,
                owner_wallet: &resource.recipient_wallet,
                quote_id: &resource.quote_id,
                payment_token_hash: Some(&payment_token_hash),
                research_job_id: None,
                policy: &policy,
            })
            .unwrap();
        assert_eq!(replay.settlement.id, delivered.settlement.id);
        let recovered = store
            .recover_pay_sh_document(&resolved.query_id, &handle, &payment_token_hash)
            .unwrap();
        assert_eq!(recovered.citations[0].handle, original.handle);
        assert_eq!(recovered.citations[0].excerpt, original.excerpt);
        let (earnings, access_events): (u64, u64) = store
            .connection()
            .unwrap()
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM earning_events WHERE settlement_id = ?1),
                    (SELECT COUNT(*) FROM memory_access_events
                     WHERE purpose = 'pay_sh_paid_evidence' AND quote_id = ?2)",
                params![delivered.settlement.id, resource.quote_id],
                |row| Ok((super::as_u64(row.get(0)?)?, super::as_u64(row.get(1)?)?)),
            )
            .unwrap();
        assert_eq!(earnings, 1);
        assert_eq!(access_events, 1);
        let refreshed = store
            .pay_sh_resource(&resolved.query_id, &handle, &payment_token_hash, &policy)
            .unwrap();
        assert_eq!(refreshed.status, "delivered");
        assert_ne!(refreshed.quote_id, resource.quote_id);
        let stale_client_retry = store
            .open_pay_sh_document(PayShDeliveryRequest {
                query_id: &resolved.query_id,
                handle: &handle,
                path_price_krw: refreshed.price_krw,
                owner_wallet: &refreshed.recipient_wallet,
                quote_id: &refreshed.quote_id,
                payment_token_hash: Some(&payment_token_hash),
                research_job_id: None,
                policy: &policy,
            })
            .unwrap();
        assert_eq!(stale_client_retry.citations[0].excerpt, original.excerpt);
        let earnings_after_retry: u64 = store
            .connection()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM earning_events WHERE settlement_id = ?1",
                [&delivered.settlement.id],
                |row| super::as_u64(row.get(0)?),
            )
            .unwrap();
        assert_eq!(earnings_after_retry, 1);
    }

    #[test]
    fn funded_research_job_pays_each_document_only_through_pay_sh() {
        let store = Store::in_memory().unwrap();
        let question = "Where do people who live in Seongsu eat lunch on weekdays?";
        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 3,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        assert!(resolved.matches.len() >= 2);
        let handles = resolved
            .matches
            .iter()
            .take(2)
            .map(|matched| matched.handle.clone())
            .collect::<Vec<_>>();
        let payment_token_hash = "c".repeat(64);
        store
            .record_resolution(question, &resolved, Some(&payment_token_hash))
            .unwrap();
        let receiver =
            bs58::encode(SigningKey::from_bytes(&[7; 32]).verifying_key().as_bytes()).into_string();
        onboard(&store, "prepaid-buyer");
        let payer = verify_wallet(&store, "prepaid-buyer", 8);
        let policy = PaymentQuotePolicy {
            fallback_recipient: Some(receiver.clone()),
            bundle_recipient: Some(receiver.clone()),
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };
        let create = CreatePaymentBundleRequest {
            query_id: resolved.query_id.clone(),
            handles: handles.clone(),
            top_up_atomic: Some("5000000".to_owned()),
        };
        let wallet_session = "e".repeat(64);
        store
            .issue_prepaid_wallet_session(
                "prepaid-buyer",
                &payer,
                &wallet_session,
                300_000,
                &policy,
            )
            .unwrap();
        let wallet_session_hash = super::hex_digest(wallet_session.as_bytes());
        assert!(matches!(
            store.create_payment_bundle(&create, &"d".repeat(64), &wallet_session_hash, &policy),
            Err(StoreError::Unauthorized(_))
        ));
        let quote = store
            .create_payment_bundle(&create, &payment_token_hash, &wallet_session_hash, &policy)
            .unwrap();
        let repeated_quote = store
            .create_payment_bundle(&create, &payment_token_hash, &wallet_session_hash, &policy)
            .unwrap();
        assert_eq!(quote.id, repeated_quote.id);
        assert_eq!(quote.document_handles, handles);
        assert_eq!(
            store
                .payment_bundle_snapshot(&quote.id)
                .unwrap()
                .citations
                .len(),
            2
        );

        let request = RecordChainSettlementRequest {
            quote_id: quote.id.clone(),
            transaction_signature: "3".repeat(88),
            payer: payer.clone(),
            pay_to: quote.pay_to.clone(),
            amount_atomic: quote.amount_atomic.clone(),
            network: quote.network.clone(),
            raw_response: serde_json::json!({ "success": true, "transaction": "3".repeat(88) }),
        };
        // The public gateway rejects an expired quote before payment. Once the
        // facilitator has settled, however, a delayed durable-outbox replay
        // must still be accepted instead of orphaning an on-chain transfer.
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE payment_bundle_quotes SET expires_at = 0 WHERE id = ?1",
                [&quote.id],
            )
            .unwrap();
        let receipt = store.record_bundle_chain_settlement(&request).unwrap();
        assert_eq!(
            store.record_bundle_chain_settlement(&request).unwrap(),
            receipt
        );
        let progress = store
            .payment_progress(&resolved.query_id, &payer, &payment_token_hash)
            .unwrap();
        assert_eq!(progress.settled_count, 0);
        let funded = store
            .research_job_status(&quote.id, &payment_token_hash)
            .unwrap();
        assert_eq!(funded.status, "funded");
        assert!(funded.citations.is_empty());
        assert_eq!(funded.pending_handles, handles);
        assert_eq!(
            funded.transaction_signature,
            Some(receipt.transaction_signature)
        );
        assert!(matches!(
            store.opened_evidence(&resolved.query_id, &handles, &payment_token_hash),
            Err(StoreError::DocumentNotQuoted)
        ));

        let plan = store.research_job_plan(&quote.id, &policy).unwrap();
        assert_eq!(plan.status, "processing");
        assert_eq!(plan.resources.len(), 2);
        assert_eq!(
            plan.resources
                .iter()
                .map(|resource| resource.amount_atomic.parse::<u64>().unwrap())
                .sum::<u64>(),
            quote.budget_atomic.parse::<u64>().unwrap()
        );
        for resource in plan.resources {
            assert!(
                resource
                    .resource_path
                    .contains(&format!("research_job_id={}", quote.id))
            );
            store
                .open_pay_sh_document(PayShDeliveryRequest {
                    query_id: &resource.query_id,
                    handle: &resource.document_handle,
                    path_price_krw: resource.price_krw,
                    owner_wallet: &resource.recipient_wallet,
                    quote_id: &resource.quote_id,
                    payment_token_hash: None,
                    research_job_id: Some(&quote.id),
                    policy: &policy,
                })
                .unwrap();
        }
        let completed = store.complete_research_job(&quote.id).unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.citations.len(), 2);
        assert!(completed.pending_handles.is_empty());
        assert_eq!(completed.spent_atomic, completed.amount_atomic);
        assert_eq!(
            store
                .opened_evidence(&resolved.query_id, &handles, &payment_token_hash)
                .unwrap()
                .1
                .len(),
            2
        );
        let refund_claims = store
            .lease_payout_claims("worker-test", &receiver, &policy.network, 10, 60_000)
            .unwrap();
        assert!(refund_claims.is_empty());

        // A second job for the same query receives fresh quote bindings. If
        // only one DB is paid, failure refunds exactly the still-unpaid DB and
        // never mistakes the first job's deliveries for this job's work.
        let partial_resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 3,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution(question, &partial_resolved, Some(&payment_token_hash))
            .unwrap();
        let partial_create = CreatePaymentBundleRequest {
            query_id: partial_resolved.query_id,
            handles: partial_resolved
                .matches
                .iter()
                .take(2)
                .map(|matched| matched.handle.clone())
                .collect(),
            top_up_atomic: Some("5000000".to_owned()),
        };
        let partial_quote = store
            .create_payment_bundle(
                &partial_create,
                &payment_token_hash,
                &wallet_session_hash,
                &policy,
            )
            .unwrap();
        assert_ne!(partial_quote.id, quote.id);
        assert_eq!(partial_quote.status, "funded");
        assert!(!partial_quote.requires_payment);
        assert_eq!(partial_quote.amount_atomic, "0");
        let partial_plan = store.research_job_plan(&partial_quote.id, &policy).unwrap();
        assert_eq!(partial_plan.resources.len(), 2);
        let first = &partial_plan.resources[0];
        store
            .open_pay_sh_document(PayShDeliveryRequest {
                query_id: &first.query_id,
                handle: &first.document_handle,
                path_price_krw: first.price_krw,
                owner_wallet: &first.recipient_wallet,
                quote_id: &first.quote_id,
                payment_token_hash: None,
                research_job_id: Some(&partial_quote.id),
                policy: &policy,
            })
            .unwrap();
        let failed = store
            .fail_research_job(&partial_quote.id, "second Pay.sh resource failed")
            .unwrap();
        assert_eq!(failed.status, "balance_refunded");
        assert_eq!(failed.citations.len(), 1);
        assert_eq!(failed.pending_handles.len(), 1);
        assert_eq!(
            failed.refundable_atomic,
            partial_plan.resources[1].amount_atomic
        );
        let refunds = store
            .lease_payout_claims("refund-worker", &receiver, &policy.network, 10, 60_000)
            .unwrap();
        assert!(refunds.is_empty());
        let balance = store.prepaid_balance("prepaid-buyer", &policy).unwrap();
        assert!(balance.available_atomic.parse::<u64>().unwrap() > 0);
        let withdrawal = store
            .create_prepaid_withdrawal("prepaid-buyer", None, &policy)
            .unwrap();
        assert_eq!(withdrawal.kind, "prepaid_withdrawal");
        assert_eq!(withdrawal.amount_atomic, balance.available_atomic);
        assert_eq!(
            store
                .prepaid_balance("prepaid-buyer", &policy)
                .unwrap()
                .available_atomic,
            "0"
        );
        let withdrawals = store
            .lease_payout_claims("withdraw-worker", &receiver, &policy.network, 10, 60_000)
            .unwrap();
        assert_eq!(withdrawals.len(), 1);
        assert_eq!(withdrawals[0].recipient_wallet, payer);
    }

    #[test]
    fn profile_and_preferences_are_server_authoritative() {
        let store = Store::in_memory().unwrap();
        let created = store
            .upsert_profile("researcher-1", &profile_request("seoul_ops"))
            .unwrap();
        assert_eq!(created.handle, "SEOUL_OPS");
        assert!(created.auto_match);
        assert!(!created.suspended);
        assert!(!created.wallet_verified);

        let updated = store
            .update_preferences(
                "researcher-1",
                &UpdatePreferencesRequest {
                    auto_match: Some(false),
                    agents: Some(true),
                    browser_alerts: None,
                    email_alerts: None,
                },
            )
            .unwrap();
        assert!(!updated.auto_match);
        assert!(updated.agents);

        let conflict = store
            .upsert_profile("researcher-2", &profile_request("SEOUL_OPS"))
            .unwrap_err();
        assert!(conflict.to_string().contains("already in use"));
    }

    #[test]
    fn only_admins_can_create_independent_verified_authority_edges() {
        let store = Store::in_memory().unwrap();
        ensure_user(&store, "curator");
        let request = CreateEvidenceEdgeRequest {
            source_handle: "PARISR_11".to_owned(),
            target_handle: "PARISR_12".to_owned(),
            relation: "corroborates".to_owned(),
            provenance: "admin_verified".to_owned(),
            topic: "travel".to_owned(),
            weight: 1.0,
        };
        assert!(store.create_evidence_edge("curator", &request).is_err());
        store.set_user_role("curator", "admin").unwrap();
        let edge = store.create_evidence_edge("curator", &request).unwrap();
        assert_eq!(edge.provenance, "admin_verified");

        let mut self_owned = request;
        self_owned.source_handle = "PARISR_12".to_owned();
        self_owned.target_handle = "PARISR_12".to_owned();
        assert!(store.create_evidence_edge("curator", &self_owned).is_err());
    }

    #[test]
    fn memory_stream_reflects_versions_locks_exports_and_publishes_a_manifest() {
        let store = Store::in_memory().unwrap();
        let answers = [
            "In January 2025 near Longyearbyen I wore Baffin boots for 6 hours on snow. The felt liner stayed warm but needed drying every night before the next field shift.",
            "During February 2025 outside Tromso I used leather mountaineering boots for 4 hours. Wet coastal snow soaked the seams, so I changed to a plastic shell after lunch.",
            "On a March 2025 survey near Kiruna I packed two wool socks and vapor barrier liners. At minus 22C the system lasted 7 hours, although walking indoors became uncomfortable.",
        ];
        for (index, answer) in answers.iter().enumerate() {
            let call = create_svalbard_call(&store, &format!("reflection-buyer-{index}"), 1);
            submit(&store, &call.id, "reflective-user", answer)
                .unwrap_or_else(|error| panic!("reflection submission {index}: {error:?}"));
        }
        let memories = store.list_memory("reflective-user").unwrap();
        assert_eq!(
            memories
                .iter()
                .filter(|memory| memory.memory_type == "observation")
                .count(),
            3
        );
        let reflection = memories
            .iter()
            .find(|memory| memory.memory_type == "reflection")
            .unwrap();
        assert!(reflection.importance >= 0.8);
        assert_eq!(reflection.earned, 0);

        let profile = store.get_profile("reflective-user").unwrap().unwrap();
        let manifest = store.contributor_manifest(&profile.handle).unwrap();
        assert_eq!(manifest.memory_count, 3);
        assert!(manifest.reliability_score > 0.5);
        assert!(
            manifest
                .memories
                .iter()
                .all(|memory| memory.content_hash.len() == 64)
        );

        let original = memories
            .iter()
            .find(|memory| memory.memory_type == "observation")
            .unwrap();
        let corrected = store
            .correct_memory(
                "reflective-user",
                &original.id,
                &CorrectMemoryRequest {
                    answer: "In January 2025 near Longyearbyen I wore Baffin boots for exactly 5 hours, not 6. The felt liner stayed warm and I dried it overnight before every field shift."
                        .to_owned(),
                },
            )
            .unwrap();
        assert_eq!(corrected.memory_type, "correction");
        assert_eq!(corrected.version, 2);
        assert!(
            store
                .list_memory("reflective-user")
                .unwrap()
                .iter()
                .find(|memory| memory.id == original.id)
                .unwrap()
                .locked
        );
        let locked = store
            .set_memory_locked("reflective-user", &corrected.id, true)
            .unwrap();
        assert!(locked.locked);
        let export = store.export_account("reflective-user").unwrap();
        assert_eq!(export.profile.unwrap().handle, profile.handle);
        assert_eq!(export.memories.len(), 5);
    }

    #[test]
    fn repeated_login_failures_are_temporarily_blocked_and_can_be_cleared() {
        let store = Store::in_memory().unwrap();
        for _ in 0..LOGIN_FAILURE_LIMIT - 1 {
            store.record_login_failure("RATE@example.com").unwrap();
            store.check_login_allowed("rate@example.com").unwrap();
        }
        store.record_login_failure("rate@example.com").unwrap();
        assert!(matches!(
            store.check_login_allowed("rate@example.com"),
            Err(StoreError::Unauthorized(_))
        ));
        store.clear_login_failures("rate@example.com").unwrap();
        store.check_login_allowed("rate@example.com").unwrap();
    }

    #[test]
    fn password_reset_tokens_are_expiring_single_use_and_revoke_sessions() {
        let store = Store::in_memory().unwrap();
        let user = store
            .register_user("reset@test.invalid", "old-password-hash")
            .unwrap();
        store
            .create_session(&user.id, &"a".repeat(64), now_ms() + 60_000)
            .unwrap();
        let raw_token = "reset-token-that-is-long-enough-1234567890";
        let token_hash = super::sha256_hex(raw_token);
        store
            .queue_password_reset(&user.email, &token_hash, raw_token, "http://localhost:4319")
            .unwrap();
        store
            .reset_password(&token_hash, "new-password-hash")
            .unwrap();
        assert_eq!(
            store.password_record(&user.email).unwrap().1,
            "new-password-hash"
        );
        assert!(matches!(
            store.authenticate_session(&"a".repeat(64)),
            Err(StoreError::Unauthorized(_))
        ));
        assert!(matches!(
            store.reset_password(&token_hash, "another-hash"),
            Err(StoreError::Unauthorized(_))
        ));
    }

    #[test]
    fn wallet_verification_proves_ownership_is_single_use_and_unique() {
        let store = Store::in_memory().unwrap();
        onboard(&store, "wallet-owner");
        let signing_key = SigningKey::from_bytes(&[9; 32]);
        let wallet = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let challenge = store
            .create_wallet_challenge("wallet-owner", &wallet, &"cd".repeat(32), 300_000)
            .unwrap();
        let signature =
            bs58::encode(signing_key.sign(challenge.message.as_bytes()).to_bytes()).into_string();
        let profile = store
            .verify_wallet_challenge("wallet-owner", &challenge.id, &signature)
            .unwrap();
        assert!(profile.wallet_verified);
        assert!(profile.wallet_verified_at.is_some());
        assert!(matches!(
            store.verify_wallet_challenge("wallet-owner", &challenge.id, &signature),
            Err(StoreError::Conflict(_))
        ));

        onboard(&store, "other-owner");
        let other_challenge = store
            .create_wallet_challenge("other-owner", &wallet, &"ef".repeat(32), 300_000)
            .unwrap();
        let other_signature = bs58::encode(
            signing_key
                .sign(other_challenge.message.as_bytes())
                .to_bytes(),
        )
        .into_string();
        assert!(matches!(
            store.verify_wallet_challenge("other-owner", &other_challenge.id, &other_signature),
            Err(StoreError::Conflict(_))
        ));

        let mut changed = profile_request("wallet_owner");
        changed.wallet = Some("11111111111111111111111111111111".to_owned());
        let changed = store.upsert_profile("wallet-owner", &changed).unwrap();
        assert!(!changed.wallet_verified);
        assert!(changed.wallet_verified_at.is_none());
    }

    #[test]
    fn pay_siwx_verifies_a_payout_wallet_without_exporting_its_key() {
        let store = Store::in_memory().unwrap();
        onboard(&store, "siwx-owner");
        let id = "ab".repeat(32);
        let uri = format!("http://127.0.0.1:8787/api/v1/profile/wallet/siwx/{id}");
        let issued_at = "2026-08-03T03:00:00Z";
        let expiration_time = "2026-08-03T03:05:00Z";
        let network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
        store
            .create_wallet_siwx_challenge(
                "siwx-owner",
                &id,
                "127.0.0.1",
                &uri,
                "Verify this Pay.sh wallet as your OPENSHELF payout wallet.",
                &"cd".repeat(32),
                issued_at,
                expiration_time,
                network,
                300_000,
            )
            .unwrap();

        let signing_key = SigningKey::from_bytes(&[11; 32]);
        let address = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let mut payload = SiwxPayload {
            domain: "127.0.0.1".to_owned(),
            address,
            uri: uri.clone(),
            statement: Some(
                "Verify this Pay.sh wallet as your OPENSHELF payout wallet.".to_owned(),
            ),
            version: "1".to_owned(),
            chain_id: network.to_owned(),
            nonce: "cd".repeat(32),
            issued_at: issued_at.to_owned(),
            expiration_time: Some(expiration_time.to_owned()),
            not_before: None,
            request_id: Some(id.clone()),
            resources: Some(vec![uri]),
            signature_type: "ed25519".to_owned(),
            signature_scheme: Some("siws".to_owned()),
            signature: String::new(),
        };
        payload.signature = bs58::encode(
            signing_key
                .sign(siwx_message(&payload).unwrap().as_bytes())
                .to_bytes(),
        )
        .into_string();

        let profile = store.verify_wallet_siwx_challenge(&id, &payload).unwrap();
        assert_eq!(profile.wallet.as_deref(), Some(payload.address.as_str()));
        assert!(profile.wallet_verified);
        assert!(matches!(
            store.verify_wallet_siwx_challenge(&id, &payload),
            Err(StoreError::Conflict(_))
        ));

        let mut tampered = payload;
        tampered.nonce = "ef".repeat(32);
        let second_id = "12".repeat(32);
        tampered.request_id = Some(second_id.clone());
        store
            .create_wallet_siwx_challenge(
                "siwx-owner",
                &second_id,
                "127.0.0.1",
                &tampered.uri,
                tampered.statement.as_deref().unwrap(),
                &"cd".repeat(32),
                issued_at,
                expiration_time,
                network,
                300_000,
            )
            .unwrap();
        assert!(matches!(
            store.verify_wallet_siwx_challenge(&second_id, &tampered),
            Err(StoreError::Unauthorized(_))
        ));
    }

    #[test]
    fn answering_requires_a_completed_profile() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let error = store
            .submit_answer(&call.id, "anonymous-reader", strong_answer())
            .unwrap_err();
        assert!(error.to_string().contains("complete onboarding"));
        assert!(store.list_memory("anonymous-reader").unwrap().is_empty());
    }

    #[test]
    fn an_answer_keeps_private_interview_context_but_indexes_only_the_paid_answer() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "interview-buyer", 1);
        onboard(&store, "interview-author");
        let context = vec![
            InterviewResponse {
                question_id: "w1".to_owned(),
                prompt: "When were you last there?".to_owned(),
                answer: "Context-only-token-alpha".to_owned(),
            },
            InterviewResponse {
                question_id: "w2".to_owned(),
                prompt: "How long were you outside?".to_owned(),
                answer: "Context-only-token-beta".to_owned(),
            },
        ];

        let submitted = store
            .submit_answer_with_interview(&call.id, "interview-author", strong_answer(), &context)
            .unwrap();
        assert_eq!(submitted.memory.interview_responses, context);

        let memory = store.list_memory("interview-author").unwrap();
        assert_eq!(memory.len(), 1);
        assert_eq!(memory[0].interview_responses, context);

        let indexed = store
            .documents()
            .unwrap()
            .into_iter()
            .find(|document| document.author_id == "interview-author")
            .unwrap();
        assert_eq!(indexed.content, strong_answer());
        assert!(!indexed.content.contains("Context-only-token-alpha"));
        assert!(!indexed.content.contains("Context-only-token-beta"));
    }

    #[test]
    fn interview_context_is_bounded_and_rejects_duplicate_questions() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "invalid-interview-buyer", 1);
        onboard(&store, "invalid-interview-author");
        let duplicate = InterviewResponse {
            question_id: "w1".to_owned(),
            prompt: "A light question".to_owned(),
            answer: "A short answer".to_owned(),
        };

        let error = store
            .submit_answer_with_interview(
                &call.id,
                "invalid-interview-author",
                strong_answer(),
                &[duplicate.clone(), duplicate],
            )
            .unwrap_err();
        assert!(error.to_string().contains("must be unique"));
        assert!(
            store
                .list_memory("invalid-interview-author")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn open_calls_reject_unknown_categories() {
        let store = Store::in_memory().unwrap();
        let error = store
            .create_open_call(
                "buyer",
                &CreateOpenCallRequest {
                    question: "Which field detail should we investigate next?".to_owned(),
                    unit_price: 500,
                    target: 3,
                    chat_id: None,
                    shelf: "Unsorted".to_owned(),
                    category: "invented-category".to_owned(),
                    filters: SearchFilters::default(),
                },
            )
            .unwrap_err();
        assert!(error.to_string().contains("unsupported category"));
    }

    #[test]
    fn funded_open_call_allocates_exact_devnet_claims_and_refunds_the_remainder() {
        let store = Store::in_memory().unwrap();
        ensure_user(&store, "funded-buyer");
        onboard(&store, "funded-author");
        let author_wallet = verify_wallet(&store, "funded-author", 31);
        let escrow_wallet =
            bs58::encode(SigningKey::from_bytes(&[32; 32]).verifying_key().as_bytes())
                .into_string();
        let payer_wallet =
            bs58::encode(SigningKey::from_bytes(&[33; 32]).verifying_key().as_bytes())
                .into_string();
        let policy = PaymentQuotePolicy {
            fallback_recipient: None,
            bundle_recipient: Some(escrow_wallet.clone()),
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };
        let request = CreateOpenCallRequest {
            question: "Which winter boots work for field research in Svalbard?".to_owned(),
            unit_price: 700,
            target: 3,
            chat_id: Some("funded-chat".to_owned()),
            shelf: "Svalbard field researchers".to_owned(),
            category: "travel".to_owned(),
            filters: SearchFilters::default(),
        };
        let balance_before = store.balance("funded-buyer").unwrap();
        let quote = store
            .create_open_call_funding_quote("funded-buyer", &request, &policy)
            .unwrap();
        assert_eq!(quote.total_price_krw, 2_100);
        let settlement = RecordChainSettlementRequest {
            quote_id: quote.id.clone(),
            transaction_signature: "4".repeat(88),
            payer: payer_wallet.clone(),
            pay_to: escrow_wallet.clone(),
            amount_atomic: quote.amount_atomic.clone(),
            network: policy.network.clone(),
            raw_response: serde_json::json!({ "success": true }),
        };
        let first = store
            .record_open_call_chain_settlement(&settlement)
            .unwrap();
        assert_eq!(
            first,
            store
                .record_open_call_chain_settlement(&settlement)
                .unwrap()
        );
        let funded_quote = store.open_call_funding_quote(&quote.id).unwrap();
        assert_eq!(funded_quote.status, "funded");
        let call_id = funded_quote.open_call_id.unwrap();
        let call = store
            .list_open_calls(Some("funded-buyer"))
            .unwrap()
            .into_iter()
            .find(|call| call.id == call_id)
            .unwrap();
        assert_eq!(call.escrow_mode, "x402_solana_escrow");
        assert_eq!(call.escrow_total_atomic, Some(quote.amount_atomic.clone()));

        store
            .submit_answer(&call_id, "funded-author", strong_answer())
            .unwrap();
        let author_claims = store.payout_claims("funded-author").unwrap();
        assert_eq!(author_claims.len(), 1);
        assert_eq!(author_claims[0].recipient_wallet, author_wallet);
        assert_eq!(author_claims[0].kind, "open_call_answer");
        store.cancel_open_call("funded-buyer", &call_id).unwrap();
        let buyer_claims = store.payout_claims("funded-buyer").unwrap();
        assert_eq!(buyer_claims.len(), 1);
        assert_eq!(buyer_claims[0].recipient_wallet, payer_wallet);
        assert_eq!(buyer_claims[0].kind, "open_call_refund");
        let claimed_atomic = author_claims[0].amount_atomic.parse::<u64>().unwrap()
            + buyer_claims[0].amount_atomic.parse::<u64>().unwrap();
        assert_eq!(claimed_atomic, quote.amount_atomic.parse::<u64>().unwrap());
        let balance_after = store.balance("funded-buyer").unwrap();
        assert_eq!(balance_after.available_krw, balance_before.available_krw);
        assert_eq!(balance_after.reserved_krw, balance_before.reserved_krw);
        assert_eq!(balance_after.held_krw, balance_before.held_krw);
    }

    #[test]
    fn accepted_answer_becomes_searchable_memory() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let submitted = submit(&store, &call.id, "researcher-1", strong_answer()).unwrap();
        assert!(submitted.issues.is_empty());
        assert_eq!(submitted.order.answered, 1);

        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Which Svalbard winter boots stay warm during field research?".to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        assert_eq!(resolved.decision, Decision::Hit);
        assert_eq!(resolved.matches.len(), 1);
    }

    #[test]
    fn voided_answer_does_not_fill_the_call_or_enter_search() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let submitted = submit(&store, &call.id, "researcher-1", "They are good boots.").unwrap();
        assert!(!submitted.issues.is_empty());
        assert_eq!(submitted.order.answered, 0);
        assert_eq!(submitted.memory.status, "voided");
        assert_eq!(submitted.memory.earned, 0);
    }

    #[test]
    fn author_cannot_answer_own_call_or_answer_twice() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 2);

        let own_error = submit(&store, &call.id, "buyer", strong_answer()).unwrap_err();
        assert!(own_error.to_string().contains("your own"));

        submit(&store, &call.id, "researcher-1", strong_answer()).unwrap();
        let duplicate_error =
            submit(&store, &call.id, "researcher-1", strong_answer()).unwrap_err();
        assert!(duplicate_error.to_string().contains("already answered"));
    }

    #[test]
    fn one_dispute_requires_review_before_restoring_a_voided_answer() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 2);
        let voided = submit(&store, &call.id, "researcher-1", "They are good boots.").unwrap();

        let pending = store
            .submit_dispute(
                &voided.memory.id,
                "researcher-1",
                "The answer was concise because the specific product evidence is in the next sentence.",
            )
            .unwrap();
        assert_eq!(pending.status, "pending");
        assert_eq!(
            store.list_memory("researcher-1").unwrap()[0].status,
            "voided"
        );

        ensure_user(&store, "reviewer");
        store.set_user_role("reviewer", "admin").unwrap();
        let restored = store
            .review_dispute(
                "reviewer",
                &voided.memory.id,
                &ReviewDisputeRequest {
                    decision: "approved".to_owned(),
                    note: "Specific evidence is sufficient on manual review.".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(restored.status, "approved");
        let memory = store.list_memory("researcher-1").unwrap();
        assert_eq!(memory[0].status, "settled");
        assert_eq!(memory[0].earned, 700);

        let second = store
            .submit_dispute(
                &voided.memory.id,
                "researcher-1",
                "This reason is also long enough but the account already spent its dispute.",
            )
            .unwrap_err();
        assert!(second.to_string().contains("already used its dispute"));
    }

    #[test]
    fn opening_is_idempotent_and_duplicate_handles_are_rejected() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let submitted = submit(&store, &call.id, "researcher-1", strong_answer()).unwrap();
        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Which Svalbard winter boots stay warm during field research?".to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution("Which Svalbard winter boots stay warm?", &resolved, None)
            .unwrap();
        let handles = vec![resolved.matches[0].handle.clone()];

        store
            .open_documents(&resolved.query_id, &handles, Some("payer-1"))
            .unwrap();
        store
            .open_documents(&resolved.query_id, &handles, Some("payer-1"))
            .unwrap();
        let memory = store.list_memory("researcher-1").unwrap();
        assert_eq!(memory[0].id, submitted.memory.id);
        assert_eq!(memory[0].earned, 1_400);
        let earnings = store.earnings("researcher-1").unwrap();
        assert_eq!(earnings.accrued_krw, 1_400);
        assert_eq!(earnings.event_count, 2);

        let duplicate = vec![handles[0].clone(), handles[0].clone()];
        let error = store
            .open_documents(&resolved.query_id, &duplicate, Some("payer-2"))
            .unwrap_err();
        assert!(error.to_string().contains("must be unique"));
    }

    #[test]
    fn x402_quote_and_chain_settlement_are_exact_and_idempotent() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let submitted = submit(&store, &call.id, "researcher-1", strong_answer()).unwrap();
        let question = "Which Svalbard winter boots stay warm during field research?";
        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        let payment_token_hash = "a".repeat(64);
        store
            .record_resolution(question, &resolved, Some(&payment_token_hash))
            .unwrap();

        let policy = PaymentQuotePolicy {
            fallback_recipient: None,
            bundle_recipient: None,
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };
        let handle = &resolved.matches[0].handle;
        let payer =
            bs58::encode(SigningKey::from_bytes(&[8; 32]).verifying_key().as_bytes()).into_string();
        let before_quote = store
            .payment_progress(&resolved.query_id, &payer, &payment_token_hash)
            .unwrap();
        assert_eq!(before_quote.documents[0].status, "unpaid");
        assert!(matches!(
            store.payment_progress(&resolved.query_id, &payer, &"b".repeat(64)),
            Err(StoreError::Unauthorized(_))
        ));
        assert!(matches!(
            store.payment_quote(&resolved.query_id, handle, &policy),
            Err(StoreError::Conflict(_))
        ));
        let verified_wallet = verify_wallet(&store, "researcher-1", 7);
        let quote = store
            .payment_quote(&resolved.query_id, handle, &policy)
            .unwrap();
        assert_eq!(quote.price_krw, 700);
        assert_eq!(quote.amount_atomic, "518519");
        assert_eq!(quote.pay_to, verified_wallet);
        assert!(matches!(
            store.paid_document(&quote.id),
            Err(StoreError::NotFound("settled payment quote"))
        ));
        let buffered_snapshot = store.payment_document_snapshot(&quote.id).unwrap();
        assert_eq!(buffered_snapshot.quote_id, quote.id);
        assert_eq!(buffered_snapshot.citation.handle, *handle);
        assert_eq!(buffered_snapshot.citation.excerpt, strong_answer());
        let corrected = store
            .correct_memory(
                "researcher-1",
                &submitted.memory.id,
                &CorrectMemoryRequest {
                    answer: "In January 2025 at Longyearbyen I wore insulated Baffin boots for 5 hours, not 6. My toes stayed warm, and I dried the removable felt liner overnight after every field shift."
                        .to_owned(),
                },
            )
            .unwrap();
        assert_ne!(corrected.answer, strong_answer());
        let quoted = store
            .payment_progress(&resolved.query_id, &payer, &payment_token_hash)
            .unwrap();
        assert_eq!(quoted.documents[0].status, "quoted");

        let request = RecordChainSettlementRequest {
            quote_id: quote.id.clone(),
            transaction_signature: "2".repeat(88),
            payer: payer.clone(),
            pay_to: quote.pay_to.clone(),
            amount_atomic: quote.amount_atomic.clone(),
            network: quote.network.clone(),
            raw_response: serde_json::json!({ "success": true, "transaction": "2".repeat(88) }),
        };
        let receipt = store.record_chain_settlement(&request).unwrap();
        let repeated = store.record_chain_settlement(&request).unwrap();
        assert_eq!(receipt.id, repeated.id);
        assert_eq!(receipt.amount_atomic, quote.amount_atomic);
        let delivered = store.paid_document(&quote.id).unwrap();
        assert_eq!(delivered.citation.handle, *handle);
        assert_eq!(delivered.citation.excerpt, strong_answer());
        assert_eq!(delivered.content_hash, quote.content_hash);
        assert_eq!(delivered.document_version, quote.document_version);
        let progress = store
            .payment_progress(&resolved.query_id, &payer, &payment_token_hash)
            .unwrap();
        assert_eq!(progress.settled_count, 1);
        assert_eq!(progress.unpaid_count, 0);
        assert_eq!(
            progress.documents[0].transaction_signature.as_deref(),
            Some(request.transaction_signature.as_str())
        );
        let recovered = store
            .recover_paid_document(&resolved.query_id, handle, &payer, &payment_token_hash)
            .unwrap();
        assert_eq!(recovered.citation.handle, *handle);
        assert_eq!(recovered.settlement.id, receipt.id);
        let reliability = || {
            store
                .connection()
                .unwrap()
                .query_row(
                    "SELECT reliability_score FROM documents WHERE handle = ?1",
                    [handle],
                    |row| row.get::<_, f32>(0),
                )
                .unwrap()
        };
        let reliability_before = reliability();
        let contributions = vec![EvidenceContribution {
            handle: handle.clone(),
            score: 0.1,
            reason: "A bounded model contribution used for an idempotency test.".to_owned(),
        }];
        store
            .record_contributions(&resolved.query_id, &contributions)
            .unwrap();
        let reliability_after_first = reliability();
        store
            .record_contributions(&resolved.query_id, &contributions)
            .unwrap();
        let reliability_after_retry = reliability();
        assert!(reliability_after_first < reliability_before);
        assert_eq!(reliability_after_retry, reliability_after_first);
        let feedback = store
            .submit_document_feedback(
                &resolved.query_id,
                handle,
                &payer,
                &payment_token_hash,
                &SubmitDocumentFeedbackRequest {
                    outcome: "report".to_owned(),
                    reason: Some(
                        "The passage contains a material factual claim that needs review."
                            .to_owned(),
                    ),
                },
            )
            .unwrap();
        assert_eq!(feedback.status, "pending");
        let repeated_feedback = store
            .submit_document_feedback(
                &resolved.query_id,
                handle,
                &payer,
                &payment_token_hash,
                &SubmitDocumentFeedbackRequest {
                    outcome: "report".to_owned(),
                    reason: feedback.reason.clone(),
                },
            )
            .unwrap();
        assert_eq!(feedback.id, repeated_feedback.id);
        ensure_user(&store, "feedback-reviewer");
        store.set_user_role("feedback-reviewer", "admin").unwrap();
        assert_eq!(
            store
                .list_document_feedback("feedback-reviewer")
                .unwrap()
                .len(),
            1
        );
        let reviewed = store
            .review_document_feedback(
                "feedback-reviewer",
                &feedback.id,
                &ReviewDocumentFeedbackRequest {
                    decision: "upheld".to_owned(),
                    note: "The claim cannot be supported by the submitted evidence.".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(reviewed.status, "upheld");

        let mut conflicting = request.clone();
        conflicting.transaction_signature = "4".repeat(88);
        assert!(matches!(
            store.record_chain_settlement(&conflicting),
            Err(StoreError::Conflict(_))
        ));

        let memory = store.list_memory("researcher-1").unwrap();
        let purchased_version = memory
            .iter()
            .find(|entry| entry.id == submitted.memory.id)
            .unwrap();
        assert_eq!(purchased_version.earned, 1_400);
        assert!(purchased_version.locked);
        let earnings = store.earnings("researcher-1").unwrap();
        assert_eq!(earnings.accrued_krw, 1_400);
        assert_eq!(earnings.available_krw, 700);
        assert!(
            earnings
                .events
                .iter()
                .any(|event| event.payout_status == "onchain")
        );
    }

    #[test]
    fn three_voided_answers_suspend_further_submissions() {
        let store = Store::in_memory().unwrap();
        for index in 0..3 {
            let call = create_svalbard_call(&store, &format!("buyer-{index}"), 1);
            submit(&store, &call.id, "repeat-offender", "They are good boots.").unwrap();
        }
        let controls = store.account_controls("repeat-offender").unwrap();
        assert_eq!(controls.strikes, 3);
        assert!(controls.suspended);

        let fourth = create_svalbard_call(&store, "buyer-four", 1);
        let error = submit(&store, &fourth.id, "repeat-offender", strong_answer()).unwrap_err();
        assert!(error.to_string().contains("suspended"));
    }

    #[test]
    fn two_strikes_disable_auto_match_and_hold_new_earnings() {
        let store = Store::in_memory().unwrap();
        store
            .upsert_profile("restricted-user", &profile_request("restricted_01"))
            .unwrap();
        for index in 0..2 {
            let call = create_svalbard_call(&store, &format!("buyer-{index}"), 1);
            submit(&store, &call.id, "restricted-user", "They are good boots.").unwrap();
        }
        let profile = store.get_profile("restricted-user").unwrap().unwrap();
        assert_eq!(profile.strikes, 2);
        assert!(!profile.auto_match);
        assert!(!profile.suspended);

        let paid_call = create_svalbard_call(&store, "buyer-paid", 1);
        submit(&store, &paid_call.id, "restricted-user", strong_answer()).unwrap();
        assert!(
            store
                .documents()
                .unwrap()
                .iter()
                .all(|document| document.author_id != "restricted-user")
        );
        let earnings = store.earnings("restricted-user").unwrap();
        assert_eq!(earnings.accrued_krw, 700);
        assert_eq!(earnings.held_krw, 700);
        assert_eq!(earnings.available_krw, 0);
        assert_eq!(earnings.events[0].payout_status, "held");
        assert!(earnings.events[0].available_at > earnings.events[0].created_at);
    }

    #[test]
    fn a_quote_cannot_open_an_author_who_became_restricted() {
        let store = Store::in_memory().unwrap();
        let source_call = create_svalbard_call(&store, "source-buyer", 1);
        submit(&store, &source_call.id, "restricted-later", strong_answer()).unwrap();
        let resolver = Resolver::new(store.documents().unwrap());
        let resolved = resolver
            .resolve(ResolveQuestionRequest {
                question: "Which Svalbard winter boots stay warm during field research?".to_owned(),
                requested_documents: 1,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        store
            .record_resolution("Svalbard winter boots", &resolved, None)
            .unwrap();

        for index in 0..2 {
            let call = create_svalbard_call(&store, &format!("strike-buyer-{index}"), 1);
            submit(&store, &call.id, "restricted-later", "They are good boots.").unwrap();
        }
        let error = store
            .open_documents(
                &resolved.query_id,
                &[resolved.matches[0].handle.clone()],
                Some("payer"),
            )
            .unwrap_err();
        assert!(error.to_string().contains("not quoted"));
    }

    #[test]
    fn earning_events_snapshot_the_recipient_wallet() {
        let store = Store::in_memory().unwrap();
        store
            .upsert_profile("researcher-1", &profile_request("wallet_owner"))
            .unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        submit(&store, &call.id, "researcher-1", strong_answer()).unwrap();

        let earnings = store.earnings("researcher-1").unwrap();
        assert_eq!(earnings.event_count, 1);
        assert_eq!(
            earnings.events[0].recipient_wallet.as_deref(),
            Some("11111111111111111111111111111111")
        );
        assert_eq!(earnings.events[0].payout_status, "accrued");
    }

    #[test]
    fn targeting_is_enforced_and_an_accepted_answer_returns_to_its_chat() {
        let store = Store::in_memory().unwrap();
        ensure_user(&store, "target-buyer");
        let call = store
            .create_open_call(
                "target-buyer",
                &CreateOpenCallRequest {
                    question: "Which winter boots work for field research in Svalbard?".to_owned(),
                    unit_price: 700,
                    target: 2,
                    chat_id: Some("chat-targeted".to_owned()),
                    shelf: "Svalbard field researchers".to_owned(),
                    category: "travel".to_owned(),
                    filters: SearchFilters {
                        region: Some("abroad".to_owned()),
                        field: Some("travel".to_owned()),
                        ..SearchFilters::default()
                    },
                },
            )
            .unwrap();

        onboard(&store, "seoul-researcher");
        let mismatch = store
            .submit_answer(&call.id, "seoul-researcher", strong_answer())
            .unwrap_err();
        assert!(mismatch.to_string().contains("does not match"));

        ensure_user(&store, "svalbard-researcher");
        let mut matching = profile_request("svalbard_01");
        matching.region = "abroad".to_owned();
        matching.household = "alone".to_owned();
        matching.field = "travel".to_owned();
        store
            .upsert_profile("svalbard-researcher", &matching)
            .unwrap();
        store
            .submit_answer(&call.id, "svalbard-researcher", strong_answer())
            .unwrap();

        let answers = store.chat_answers("target-buyer", "chat-targeted").unwrap();
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].handle, "SVALBARD_01");
        assert!(answers[0].excerpt.contains("Longyearbyen"));
        assert_eq!(answers[0].demographics.as_ref().unwrap().region, "abroad");
        assert!(
            store
                .chat_answers("someone-else", "chat-targeted")
                .unwrap()
                .is_empty()
        );

        let buyer = store.balance("target-buyer").unwrap();
        assert_eq!(buyer.available_krw, 98_600);
        assert_eq!(buyer.reserved_krw, 700);
        let contributor = store.balance("svalbard-researcher").unwrap();
        assert_eq!(contributor.available_krw, 100_700);

        store.cancel_open_call("target-buyer", &call.id).unwrap();
        let refunded = store.balance("target-buyer").unwrap();
        assert_eq!(refunded.available_krw, 99_300);
        assert_eq!(refunded.reserved_krw, 0);
        assert!(
            store
                .list_open_calls(None)
                .unwrap()
                .iter()
                .all(|listed| listed.id != call.id)
        );
        let cancelled = store
            .list_open_calls(Some("target-buyer"))
            .unwrap()
            .into_iter()
            .find(|listed| listed.id == call.id)
            .unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.escrow_remaining_krw, 0);
    }

    #[test]
    fn rejected_dispute_never_restores_a_slot_or_payment() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "buyer", 1);
        let voided = submit(&store, &call.id, "researcher-1", "They are good boots.").unwrap();
        store
            .submit_dispute(
                &voided.memory.id,
                "researcher-1",
                "The automated check may have missed context, so I request a human review.",
            )
            .unwrap();
        ensure_user(&store, "reviewer");
        store.set_user_role("reviewer", "admin").unwrap();
        store
            .review_dispute(
                "reviewer",
                &voided.memory.id,
                &ReviewDisputeRequest {
                    decision: "rejected".to_owned(),
                    note: "The answer contains no concrete lived evidence.".to_owned(),
                },
            )
            .unwrap();
        let memory = store.list_memory("researcher-1").unwrap();
        assert_eq!(memory[0].status, "voided");
        assert_eq!(memory[0].earned, 0);
        assert_eq!(store.balance("buyer").unwrap().reserved_krw, 700);
        assert_eq!(
            store.balance("researcher-1").unwrap().available_krw,
            100_000
        );
    }

    #[test]
    fn account_deletion_revokes_identity_and_burns_private_data() {
        let store = Store::in_memory().unwrap();
        ensure_user(&store, "delete-me");
        store
            .upsert_profile("delete-me", &profile_request("delete_me"))
            .unwrap();
        let call = create_svalbard_call(&store, "delete-me", 1);
        assert_eq!(store.balance("delete-me").unwrap().reserved_krw, 700);

        store.delete_account("delete-me").unwrap();

        assert!(store.get_profile("delete-me").unwrap().is_none());
        assert!(matches!(
            store.balance("delete-me"),
            Err(StoreError::NotFound("balance"))
        ));
        assert!(matches!(
            store.password_record("delete-me@test.invalid"),
            Err(StoreError::Unauthorized(_))
        ));
        assert!(
            store
                .list_open_calls(Some("delete-me"))
                .unwrap()
                .iter()
                .all(|item| item.id != call.id)
        );
    }

    #[test]
    fn one_active_reservation_protects_the_last_slot() {
        let store = Store::in_memory().unwrap();
        let call = create_svalbard_call(&store, "reservation-buyer", 1);
        onboard(&store, "reservation-first");
        onboard(&store, "reservation-second");

        let reservation = store
            .reserve_open_call(&call.id, "reservation-first")
            .unwrap();
        assert!(reservation.expires_at > now_ms());
        let error = store
            .reserve_open_call(&call.id, "reservation-second")
            .unwrap_err();
        assert!(error.to_string().contains("temporarily reserved"));

        store
            .release_open_call_reservation(&call.id, "reservation-first")
            .unwrap();
        store
            .reserve_open_call(&call.id, "reservation-second")
            .unwrap();
    }

    #[test]
    fn matching_call_creates_an_unread_notification_and_email_outbox() {
        let store = Store::in_memory().unwrap();
        onboard(&store, "notified-contributor");
        store
            .update_preferences(
                "notified-contributor",
                &UpdatePreferencesRequest {
                    auto_match: None,
                    agents: None,
                    browser_alerts: Some(true),
                    email_alerts: Some(true),
                },
            )
            .unwrap();

        let call = create_svalbard_call(&store, "notification-buyer", 1);
        let notifications = store.list_notifications("notified-contributor").unwrap();
        let available = notifications
            .iter()
            .find(|notification| {
                notification.kind == "call_available"
                    && notification.open_call_id.as_deref() == Some(call.id.as_str())
            })
            .expect("matching contributor should be notified");
        assert!(available.read_at.is_none());
        assert!(
            store
                .pending_emails(10)
                .unwrap()
                .iter()
                .any(|email| { email.recipient == "notified-contributor@test.invalid" })
        );

        store
            .mark_notifications_read("notified-contributor", std::slice::from_ref(&available.id))
            .unwrap();
        assert!(
            store
                .list_notifications("notified-contributor")
                .unwrap()
                .iter()
                .find(|notification| notification.id == available.id)
                .and_then(|notification| notification.read_at)
                .is_some()
        );
    }

    #[test]
    fn agent_reuses_only_a_high_confidence_paid_memory() {
        let store = Store::in_memory().unwrap();
        let first = create_svalbard_call(&store, "first-agent-buyer", 1);
        let submitted = submit(&store, &first.id, "agent-contributor", strong_answer()).unwrap();
        assert_eq!(submitted.memory.status, "settled");
        store
            .update_preferences(
                "agent-contributor",
                &UpdatePreferencesRequest {
                    auto_match: Some(true),
                    agents: Some(true),
                    browser_alerts: None,
                    email_alerts: None,
                },
            )
            .unwrap();

        let second = create_svalbard_call(&store, "second-agent-buyer", 1);
        assert_eq!(second.answered, 1);
        assert_eq!(second.status, "filled");
        let auto = store
            .list_memory("agent-contributor")
            .unwrap()
            .into_iter()
            .find(|entry| entry.via == "Auto-match")
            .expect("near-identical call should reuse the existing memory");
        assert_eq!(auto.answer, strong_answer());
        assert_eq!(auto.earned, second.unit_price);
        assert_eq!(auto.source_ids, vec![submitted.memory.id]);
    }

    #[test]
    fn ai_liquidity_is_ephemeral_and_never_enters_the_human_index() {
        let store = Store::in_memory().unwrap();
        let documents_before = store.documents().unwrap().len();
        let question = "How should someone generally evaluate a new kind of local workspace?";
        let resolver = Resolver::new(store.documents().unwrap());
        let response = resolver
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 5,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        assert_eq!(response.liquidity_state, LiquidityState::AiLiquidityOnly);
        assert!(response.ai_baseline_eligible);
        let token_hash = "ab".repeat(32);
        store
            .record_resolution(question, &response, Some(&token_hash))
            .unwrap();
        let (_, cached) = store
            .ai_baseline_context(&response.query_id, &token_hash)
            .unwrap();
        assert!(cached.is_none());

        let baseline = store
            .record_ai_baseline(
                &response.query_id,
                &token_hash,
                &AiBaselineDraft {
                    orientation: "Workspaces are generally evaluated through access, comfort, and operating rules."
                        .to_owned(),
                    general_points: vec!["Compare noise, seating, power, and time limits."
                        .to_owned()],
                    human_gaps: vec![
                        "Recent crowding and staff practice require a firsthand visitor."
                            .to_owned(),
                    ],
                    questions_for_people: vec![
                        "When did you last stay there for more than two hours?".to_owned(),
                    ],
                },
                &AiArtifactMetadata {
                    model: "gemini-test",
                    mode: "test",
                    policy_version: "general-liquidity-v1",
                    ttl_ms: 60_000,
                },
            )
            .unwrap();
        assert_eq!(baseline.price_krw, 0);
        assert!(!baseline.sellable);
        assert!(!baseline.counts_as_human_coverage);
        assert_eq!(store.documents().unwrap().len(), documents_before);

        let (_, cached) = store
            .ai_baseline_context(&response.query_id, &token_hash)
            .unwrap();
        assert_eq!(cached.unwrap().id, baseline.id);
    }

    #[test]
    fn query_payment_capability_expires_server_side() {
        let store = Store::in_memory().unwrap();
        let question = "How should someone generally evaluate an unfamiliar local workspace?";
        let response = Resolver::new(store.documents().unwrap())
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 5,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .unwrap();
        let token_hash = "ef".repeat(32);
        store
            .record_resolution(question, &response, Some(&token_hash))
            .unwrap();
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE queries SET payment_token_expires_at = 0 WHERE id = ?1",
                [response.query_id.as_str()],
            )
            .unwrap();
        assert!(matches!(
            store.ai_baseline_context(&response.query_id, &token_hash),
            Err(StoreError::Unauthorized(_))
        ));
    }

    #[test]
    fn ai_liquidity_metrics_keep_ai_out_of_priced_inventory_and_authority() {
        let store = Store::in_memory().unwrap();
        ensure_user(&store, "metrics-admin");
        ensure_user(&store, "metrics-user");
        store.set_user_role("metrics-admin", "admin").unwrap();
        assert!(matches!(
            store.ai_liquidity_metrics("metrics-user"),
            Err(StoreError::Unauthorized(_))
        ));
        let metrics = store.ai_liquidity_metrics("metrics-admin").unwrap();
        assert_eq!(metrics.priced_ai_documents, 0);
        assert_eq!(metrics.ai_authority_edges, 0);
        assert!(metrics.human_documents > 0);
        assert!(metrics.starter_to_human_document_rate >= 0.0);
        assert!(metrics.starter_to_human_document_rate <= 1.0);
    }

    #[test]
    fn sufficient_human_supply_disables_ai_liquidity_even_when_budget_blocks_purchase() {
        let store = Store::in_memory().unwrap();
        let question = "Where do Seongsu residents eat weekday lunch without a long queue?";
        let response = Resolver::new(store.documents().unwrap())
            .resolve(ResolveQuestionRequest {
                question: question.to_owned(),
                requested_documents: 1,
                budget_krw: Some(0),
                filters: SearchFilters::default(),
            })
            .unwrap();
        assert_eq!(response.liquidity_state, LiquidityState::HumanCovered);
        assert!(!response.ai_baseline_eligible);
        let token_hash = "cd".repeat(32);
        store
            .record_resolution(question, &response, Some(&token_hash))
            .unwrap();
        let error = store
            .ai_baseline_context(&response.query_id, &token_hash)
            .unwrap_err();
        assert!(error.to_string().contains("AI liquidity is disabled"));
    }

    #[test]
    fn ai_starter_is_only_a_prompt_until_a_human_creates_the_sellable_document() {
        let store = Store::in_memory().unwrap();
        onboard(&store, "starter-contributor");
        let documents_before = store.documents().unwrap().len();
        let drafts = vec![
            ShelfStarterDraft {
                prompt: "Think of your latest winter field trip. Which boots did you use, when, and what changed after several hours?".to_owned(),
                rationale: "A delayed field outcome requires firsthand experience.".to_owned(),
                category: "travel".to_owned(),
            },
            ShelfStarterDraft {
                prompt: "Describe the last on-call alert you removed and what happened during the following 30 days.".to_owned(),
                rationale: "The operational tradeoff cannot be generated honestly.".to_owned(),
                category: "engineering".to_owned(),
            },
            ShelfStarterDraft {
                prompt: "What changed after you moved away from Seoul while keeping the same work, including one concrete weekly routine?".to_owned(),
                rationale: "A lived routine adds evidence beyond general guidance.".to_owned(),
                category: "life".to_owned(),
            },
        ];
        let starters = store
            .record_shelf_starters(
                "starter-contributor",
                &drafts,
                "gemini-test",
                "test",
                "general-liquidity-v1",
                60_000,
            )
            .unwrap();
        assert_eq!(starters.len(), 3);
        assert!(starters.iter().all(|starter| !starter.buyer_waiting));
        assert!(
            starters
                .iter()
                .all(|starter| starter.guaranteed_reward_krw == 0)
        );
        assert_eq!(store.documents().unwrap().len(), documents_before);

        let travel = starters
            .iter()
            .find(|starter| starter.category == "travel")
            .unwrap();
        let submitted = store
            .submit_shelf_starter_answer("starter-contributor", &travel.id, strong_answer(), 300)
            .unwrap();
        assert_eq!(submitted.memory.via, "Shelf starter");
        assert_eq!(submitted.memory.earned, 0);
        assert_eq!(store.documents().unwrap().len(), documents_before + 1);
        assert!(
            !store
                .list_shelf_starters("starter-contributor")
                .unwrap()
                .iter()
                .any(|starter| starter.id == travel.id)
        );
    }

    #[test]
    fn sqlite_data_survives_reopen() {
        let path = PathBuf::from(format!(
            "/tmp/openshelf-store-test-{}-{}.db",
            std::process::id(),
            now_ms()
        ));
        {
            let store = Store::open(&path).unwrap();
            create_svalbard_call(&store, "persistent-buyer", 1);
        }
        {
            let reopened = Store::open(&path).unwrap();
            let calls = reopened.list_open_calls(Some("persistent-buyer")).unwrap();
            assert!(calls.iter().any(|call| call.mine));
        }
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn migration_adds_payout_availability_to_existing_ledgers() {
        let path = PathBuf::from(format!(
            "/tmp/openshelf-migration-test-{}-{}.db",
            std::process::id(),
            now_ms()
        ));
        {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE earning_events (
                        id TEXT PRIMARY KEY,
                        settlement_id TEXT,
                        memory_id TEXT,
                        document_id TEXT,
                        author_id TEXT NOT NULL,
                        source TEXT NOT NULL,
                        amount_krw INTEGER NOT NULL,
                        recipient_wallet TEXT,
                        payout_status TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    );",
                )
                .unwrap();
        }
        {
            let migrated = Store::open(&path).unwrap();
            let earnings = migrated.earnings("demo-user").unwrap();
            assert_eq!(earnings.event_count, 3);
            assert!(
                earnings
                    .events
                    .iter()
                    .all(|event| event.available_at == event.created_at)
            );
        }
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }
}
