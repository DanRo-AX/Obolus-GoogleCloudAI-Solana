use std::{
    collections::HashSet,
    path::Path,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use thiserror::Error;

use crate::{
    domain::{
        AccountControls, BalanceSummary, ChainSettlementReceipt, ChatAnswer, Citation,
        CreateOpenCallRequest, DemographicBands, DisputeCase, Document, EarningEvent,
        EarningsSummary, MemoryEntry, OpenCall, OpenDocumentsResponse, PaidDocument, PaymentQuote,
        RecordChainSettlementRequest, ResolveQuestionResponse, ReviewDisputeRequest, SearchFilters,
        Settlement, SubmitAnswerResponse, UpdatePreferencesRequest, UpsertProfileRequest,
        UserAccount, UserProfile,
    },
    quality, seed,
};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);
const STRIKE_LIMIT: usize = 3;
const AUTO_MATCH_STRIKE_LIMIT: usize = 2;
const PAYOUT_HOLD_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
const SIGNUP_CREDIT_KRW: u64 = 100_000;
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

#[derive(Debug, Clone)]
pub struct PaymentQuotePolicy {
    pub fallback_recipient: Option<String>,
    pub network: String,
    pub asset: String,
    pub krw_per_usdc: u64,
    pub ttl_ms: u64,
}

#[derive(Clone)]
pub struct Store {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
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
            status: self.status.clone(),
        }
    }
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Self::from_connection(connection)
    }

    pub fn in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self, StoreError> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        store.migrate()?;
        store.seed()?;
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
            "SELECT COALESCE(SUM(amount_krw), 0) FROM earning_events
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
                locked INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS queries (
                id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                decision TEXT NOT NULL,
                created_at INTEGER NOT NULL
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
                target_field TEXT
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
                rating INTEGER
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
                created_at INTEGER NOT NULL
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
                agreed_at INTEGER NOT NULL,
                auto_match INTEGER NOT NULL DEFAULT 1,
                agents INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
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

            CREATE INDEX IF NOT EXISTS idx_documents_active
                ON documents(locked, category);
            CREATE INDEX IF NOT EXISTS idx_open_calls_created
                ON open_calls(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_user
                ON memory_entries(user_id, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_one_answer_per_call
                ON memory_entries(open_call_id, user_id)
                WHERE open_call_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_earnings_author
                ON earning_events(author_id, created_at DESC);
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
            "#,
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
            [],
        )?;
        connection.execute(
            "UPDATE open_calls
             SET escrow_remaining_krw = unit_price_krw * (target - answered)
             WHERE escrow_remaining_krw = 0 AND status = 'open' AND unit_price_krw > 0",
            [],
        )?;
        connection.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0
             WHERE owner_id <> 'seed-buyer'
               AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id = open_calls.owner_id)",
            [],
        )?;
        connection.execute(
            "UPDATE dispute_events SET status = 'approved' WHERE status = 'pending' AND reason = ''",
            [],
        )?;
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
        }
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

    pub fn record_resolution(
        &self,
        question: &str,
        response: &ResolveQuestionResponse,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO queries (id, question, decision, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                response.query_id,
                question,
                format!("{:?}", response.decision).to_lowercase(),
                as_i64(now_ms())?
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

    pub fn list_open_calls(&self, user_id: Option<&str>) -> Result<Vec<OpenCall>, StoreError> {
        let connection = self.connection()?;
        let profile = if let Some(user_id) = user_id {
            load_profile(&connection, user_id)?
        } else {
            None
        };
        let mut statement = connection.prepare(
            "SELECT id, owner_id, question, unit_price_krw, target, answered,
                    created_at, chat_id, shelf, category, target_age_band,
                    target_region, target_household, target_field,
                    escrow_remaining_krw, status
             FROM open_calls
             WHERE status IN ('open', 'filled')
                OR (status = 'cancelled' AND owner_id = ?1)
             ORDER BY created_at DESC",
        )?;
        let calls = statement
            .query_map([user_id], stored_call_from_row)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|call| call.public(user_id, profile.as_ref()))
            .collect();
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
        let profile = self.get_profile(owner_id)?;
        Ok(OpenCall {
            id,
            question: request.question.trim().to_owned(),
            unit_price: request.unit_price,
            target: request.target,
            answered: 0,
            created_at,
            chat_id: request.chat_id.clone(),
            mine: true,
            shelf: request.shelf.trim().to_owned(),
            category: request.category.trim().to_owned(),
            filters: effective_filters.clone(),
            eligible: profile
                .as_ref()
                .is_some_and(|profile| profile_matches(profile, &effective_filters)),
            escrow_remaining_krw: total,
            status: "open".to_owned(),
        })
    }

    pub fn submit_answer(
        &self,
        open_call_id: &str,
        user_id: &str,
        answer: &str,
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

        let issues = quality::assess(&call.question, answer);
        let voided = !issues.is_empty();
        let created_at = now_ms();
        let memory_id = new_id("memory");
        let document_id = (!voided).then(|| new_id("md"));
        let handle = document_id.as_ref().map(|id| handle_from_id(id));

        if let (Some(document_id), Some(handle)) = (&document_id, &handle) {
            let document = Document {
                id: document_id.clone(),
                handle: handle.clone(),
                author_id: user_id.to_owned(),
                shelf_id: slug(&call.shelf),
                shelf: call.shelf.clone(),
                category: call.category.clone(),
                content: answer.trim().to_owned(),
                tags: call
                    .question
                    .split_whitespace()
                    .take(12)
                    .map(|term| term.trim_matches(|c: char| !c.is_alphanumeric()).to_owned())
                    .filter(|term| !term.is_empty())
                    .collect(),
                price_krw: call.unit_price,
                age_days: 0,
                quality_score: 0.85,
                reliability_score: 0.8,
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
            transaction.execute(
                "UPDATE open_calls SET answered = answered + 1,
                    escrow_remaining_krw = escrow_remaining_krw - unit_price_krw,
                    status = CASE WHEN answered + 1 >= target THEN 'filled' ELSE status END
                 WHERE id = ?1",
                [open_call_id],
            )?;
            transaction.execute(
                "UPDATE balances SET reserved_krw = reserved_krw - ?1, updated_at = ?2
                 WHERE user_id = ?3 AND reserved_krw >= ?1",
                params![as_i64(call.unit_price)?, as_i64(created_at)?, call.owner_id],
            )?;
        }

        transaction.execute(
            "INSERT INTO memory_entries
             (id, user_id, open_call_id, document_id, question, answer, shelf,
              earned_krw, created_at, via, status, flags_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Open call', ?10, ?11)",
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
            ],
        )?;
        if !voided {
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

        let updated_call = StoredCall {
            answered: call.answered + usize::from(!voided),
            escrow_remaining_krw: call.escrow_remaining_krw.saturating_sub(if voided {
                0
            } else {
                call.unit_price
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
                    (SELECT status FROM dispute_events d WHERE d.memory_id = memory_entries.id)
             FROM memory_entries WHERE user_id = ?1 ORDER BY created_at DESC",
        )?;
        let entries = statement
            .query_map([user_id], memory_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
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
                  speaks_to_json, wallet, agreed_at, auto_match, agents, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?10, ?10)
                 ON CONFLICT(user_id) DO UPDATE SET
                   handle = excluded.handle,
                   age_band = excluded.age_band,
                   region = excluded.region,
                   household = excluded.household,
                   field = excluded.field,
                   years = excluded.years,
                   speaks_to_json = excluded.speaks_to_json,
                   wallet = excluded.wallet,
                   auto_match = excluded.auto_match,
                   agents = excluded.agents,
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
                    i64::from(request.auto_match),
                    i64::from(request.agents),
                ],
            )?;
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
        if request.auto_match.is_none() && request.agents.is_none() {
            return Err(StoreError::Validation(
                "at least one preference is required".to_owned(),
            ));
        }
        let changed = self.connection()?.execute(
            "UPDATE profiles
             SET auto_match = COALESCE(?1, auto_match),
                 agents = COALESCE(?2, agents),
                 updated_at = ?3
             WHERE user_id = ?4",
            params![
                request.auto_match.map(i64::from),
                request.agents.map(i64::from),
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

    pub fn earnings(&self, user_id: &str) -> Result<EarningsSummary, StoreError> {
        if user_id.trim().is_empty() {
            return Err(StoreError::Validation("user id is required".to_owned()));
        }
        self.release_matured_holds(user_id.trim())?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT e.id, e.settlement_id, e.memory_id, d.handle, e.source,
                    e.amount_krw, e.recipient_wallet, e.payout_status,
                    e.available_at, e.created_at
             FROM earning_events e
             LEFT JOIN documents d ON d.id = e.document_id
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
        Ok(EarningsSummary {
            accrued_krw,
            held_krw,
            available_krw,
            event_count: events.len(),
            events,
        })
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
            .query_map([], dispute_from_row)?
            .collect::<Result<Vec<_>, _>>()?)
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
                            m.open_call_id, c.category, c.unit_price_krw, c.owner_id
                     FROM memory_entries m
                     JOIN open_calls c ON c.id = m.open_call_id
                     WHERE m.id = ?1 AND m.user_id = ?2",
                    params![memory_id, dispute.user_id],
                    |row| {
                        Ok((
                            memory_from_row(row)?,
                            row.get::<_, String>(11)?,
                            row.get::<_, String>(12)?,
                            as_u64(row.get(13)?)?,
                            row.get::<_, String>(14)?,
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
        let changed = transaction.execute(
            "UPDATE balances
             SET available_krw = available_krw + ?1,
                 reserved_krw = reserved_krw - ?1,
                 updated_at = ?2
             WHERE user_id = ?3 AND reserved_krw >= ?1",
            params![as_i64(refund)?, as_i64(now_ms())?, user_id],
        )?;
        if changed == 0 && refund > 0 {
            return Err(StoreError::Conflict(
                "reserved balance is inconsistent with this call".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0 WHERE id = ?1",
            [open_call_id],
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
                as_i64(now_ms())?
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        call.status = "cancelled".to_owned();
        call.escrow_remaining_krw = 0;
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
            "SELECT m.id, m.open_call_id, d.handle, m.shelf, m.answer, m.earned_krw,
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
        let refund = transaction.query_row(
            "SELECT COALESCE(SUM(escrow_remaining_krw), 0)
             FROM open_calls WHERE owner_id = ?1 AND status = 'open'",
            [user_id],
            |row| as_u64(row.get(0)?),
        )?;
        transaction.execute(
            "UPDATE open_calls SET status = 'cancelled', escrow_remaining_krw = 0
             WHERE owner_id = ?1 AND status = 'open'",
            [user_id],
        )?;
        if refund > 0 {
            transaction.execute(
                "UPDATE balances SET available_krw = available_krw + ?1,
                    reserved_krw = reserved_krw - ?1, updated_at = ?2
                 WHERE user_id = ?3 AND reserved_krw >= ?1",
                params![as_i64(refund)?, as_i64(now_ms())?, user_id],
            )?;
        }

        let anonymous = format!("deleted:{}", new_id("account"));
        transaction.execute(
            "DELETE FROM query_matches WHERE document_handle IN
             (SELECT handle FROM documents WHERE author_id = ?1)",
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
        let (document_id, document_handle, price_krw, profile_wallet) = transaction
            .query_row(
                "SELECT d.id, d.handle, qm.quoted_price_krw, p.wallet
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
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::DocumentNotQuoted)?;

        let pay_to = profile_wallet
            .filter(|wallet| !wallet.trim().is_empty())
            .or_else(|| policy.fallback_recipient.clone())
            .ok_or_else(|| {
                StoreError::Conflict(
                    "this document has no payout wallet; configure OPENSHELF_DEFAULT_RECEIVER for seeded content"
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
                  amount_atomic, price_krw, krw_per_usdc, expires_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
        })
    }

    pub fn paid_document(&self, quote_id: &str) -> Result<PaidDocument, StoreError> {
        let now = now_ms();
        self.connection()?
            .query_row(
                "SELECT pq.id, d.handle, d.shelf, d.content, pq.price_krw
                 FROM payment_quotes pq
                 JOIN documents d ON d.id = pq.document_id
                 LEFT JOIN profiles p ON p.user_id = d.author_id
                 WHERE pq.id = ?1 AND pq.expires_at > ?2 AND d.locked = 0
                   AND COALESCE(p.auto_match, 1) = 1
                   AND (SELECT COUNT(*) FROM memory_entries strikes
                        WHERE strikes.user_id = d.author_id
                          AND strikes.status = 'voided') < ?3",
                params![
                    quote_id.trim(),
                    as_i64(now)?,
                    AUTO_MATCH_STRIKE_LIMIT as i64
                ],
                |row| {
                    Ok(PaidDocument {
                        quote_id: row.get(0)?,
                        citation: Citation {
                            handle: row.get(1)?,
                            shelf: row.get(2)?,
                            excerpt: row.get(3)?,
                            price: as_u64(row.get(4)?)?,
                        },
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("active payment quote"))
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

        let (
            query_id,
            document_id,
            handle,
            pay_to,
            network,
            quoted_atomic,
            price_krw,
            expires_at,
            author_id,
            memory_id,
        ) = transaction
            .query_row(
                "SELECT pq.query_id, pq.document_id, pq.document_handle, pq.pay_to,
                        pq.network, pq.amount_atomic, pq.price_krw, pq.expires_at,
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
                        as_u64(row.get(7)?)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, Option<String>>(9)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound("payment quote"))?;

        if now_ms() > expires_at.saturating_add(120_000) {
            return Err(StoreError::Conflict("payment quote has expired".to_owned()));
        }
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
            "UPDATE payment_quotes SET settled_at = ?1 WHERE id = ?2",
            params![as_i64(confirmed_at)?, request.quote_id.trim()],
        )?;
        transaction.execute(
            "UPDATE memory_entries SET earned_krw = earned_krw + ?1
             WHERE document_id = ?2 AND status = 'settled'",
            params![as_i64(price_krw)?, document_id],
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

fn load_profile(connection: &Connection, user_id: &str) -> Result<Option<UserProfile>, StoreError> {
    Ok(connection
        .query_row(
            "SELECT p.handle, p.age_band, p.region, p.household, p.field, p.years,
                    p.speaks_to_json, p.wallet, p.agreed_at, p.auto_match, p.agents,
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

fn dispute_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DisputeCase> {
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

fn profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserProfile> {
    let speaks_to_json: String = row.get(6)?;
    let strikes = as_usize(row.get(11)?)?;
    let configured_auto_match = row.get::<_, i64>(9)? != 0;
    Ok(UserProfile {
        handle: row.get(0)?,
        age_band: row.get(1)?,
        region: row.get(2)?,
        household: row.get(3)?,
        field: row.get(4)?,
        years: row.get(5)?,
        speaks_to: serde_json::from_str(&speaks_to_json).unwrap_or_default(),
        wallet: row.get(7)?,
        agreed_at: as_u64(row.get(8)?)?,
        auto_match: configured_auto_match && strikes < AUTO_MATCH_STRIKE_LIMIT,
        agents: row.get::<_, i64>(10)? != 0,
        strikes,
        dispute_used: row.get::<_, i64>(12)? != 0,
        suspended: strikes >= STRIKE_LIMIT,
    })
}

fn earning_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EarningEvent> {
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
        available_at,
        created_at: as_u64(row.get(9)?)?,
    })
}

fn chain_settlement_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChainSettlementReceipt> {
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

fn is_base58(value: &str) -> bool {
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    !value.is_empty() && value.chars().all(|character| BASE58.contains(character))
}

fn valid_solana_address(value: &str) -> bool {
    (32..=44).contains(&value.len()) && is_base58(value)
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

fn load_call(transaction: &Transaction<'_>, id: &str) -> Result<StoredCall, StoreError> {
    transaction
        .query_row(
            "SELECT id, owner_id, question, unit_price_krw, target, answered,
                    created_at, chat_id, shelf, category, target_age_band,
                    target_region, target_household, target_field,
                    escrow_remaining_krw, status
             FROM open_calls WHERE id = ?1",
            [id],
            stored_call_from_row,
        )
        .optional()?
        .ok_or(StoreError::NotFound("open call"))
}

fn stored_call_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredCall> {
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
    })
}

fn memory_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryEntry> {
    let flags_json: String = row.get(8)?;
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
    })
}

fn document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
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
          price_krw, created_at, quality_score, reliability_score, locked)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
        ],
    )?;
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
    id.replace(|character: char| !character.is_ascii_alphanumeric(), "")
        .to_uppercase()
        .chars()
        .take(12)
        .collect()
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

fn as_u64(value: i64) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn as_usize(value: i64) -> rusqlite::Result<usize> {
    usize::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let present = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column);
    drop(statement);
    if !present {
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

    use crate::{
        domain::{
            CreateOpenCallRequest, Decision, RecordChainSettlementRequest, ResolveQuestionRequest,
            ReviewDisputeRequest, SearchFilters, SubmitAnswerResponse, UpdatePreferencesRequest,
            UpsertProfileRequest,
        },
        search::Resolver,
    };

    use super::{PaymentQuotePolicy, Store, StoreError, now_ms};

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
    fn profile_and_preferences_are_server_authoritative() {
        let store = Store::in_memory().unwrap();
        let created = store
            .upsert_profile("researcher-1", &profile_request("seoul_ops"))
            .unwrap();
        assert_eq!(created.handle, "SEOUL_OPS");
        assert!(created.auto_match);
        assert!(!created.suspended);

        let updated = store
            .update_preferences(
                "researcher-1",
                &UpdatePreferencesRequest {
                    auto_match: Some(false),
                    agents: Some(true),
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
            .record_resolution("Which Svalbard winter boots stay warm?", &resolved)
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
        store.record_resolution(question, &resolved).unwrap();

        let policy = PaymentQuotePolicy {
            fallback_recipient: None,
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
            asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
            krw_per_usdc: 1_350,
            ttl_ms: 300_000,
        };
        let handle = &resolved.matches[0].handle;
        let quote = store
            .payment_quote(&resolved.query_id, handle, &policy)
            .unwrap();
        assert_eq!(quote.price_krw, 700);
        assert_eq!(quote.amount_atomic, "518519");
        assert_eq!(quote.pay_to, "11111111111111111111111111111111");
        assert_eq!(
            store.paid_document(&quote.id).unwrap().citation.handle,
            *handle
        );

        let request = RecordChainSettlementRequest {
            quote_id: quote.id.clone(),
            transaction_signature: "2".repeat(88),
            payer: "3".repeat(32),
            pay_to: quote.pay_to.clone(),
            amount_atomic: quote.amount_atomic.clone(),
            network: quote.network.clone(),
            raw_response: serde_json::json!({ "success": true, "transaction": "2".repeat(88) }),
        };
        let receipt = store.record_chain_settlement(&request).unwrap();
        let repeated = store.record_chain_settlement(&request).unwrap();
        assert_eq!(receipt.id, repeated.id);
        assert_eq!(receipt.amount_atomic, quote.amount_atomic);

        let mut conflicting = request.clone();
        conflicting.transaction_signature = "4".repeat(88);
        assert!(matches!(
            store.record_chain_settlement(&conflicting),
            Err(StoreError::Conflict(_))
        ));

        let memory = store.list_memory("researcher-1").unwrap();
        assert_eq!(memory[0].id, submitted.memory.id);
        assert_eq!(memory[0].earned, 1_400);
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
            .record_resolution("Svalbard winter boots", &resolved)
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
