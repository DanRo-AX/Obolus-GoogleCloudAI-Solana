use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEFAULT_REQUESTED_DOCUMENTS: usize = 5;
pub const MAX_REQUESTED_DOCUMENTS: usize = 20;
pub const CATEGORY_IDS: &[&str] = &[
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

fn default_requested_documents() -> usize {
    DEFAULT_REQUESTED_DOCUMENTS
}

#[derive(Debug, Clone)]
pub struct Document {
    pub id: String,
    pub handle: String,
    pub author_id: String,
    pub shelf_id: String,
    pub shelf: String,
    pub category: String,
    pub content: String,
    pub tags: Vec<String>,
    pub price_krw: u64,
    pub age_days: u32,
    pub quality_score: f32,
    pub reliability_score: f32,
    pub locked: bool,
    pub demographics: Option<DemographicBands>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceEdge {
    pub source_document_id: String,
    pub target_document_id: String,
    pub relation: String,
    pub provenance: String,
    pub topic: String,
    pub weight: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEvidenceEdgeRequest {
    pub source_handle: String,
    pub target_handle: String,
    pub relation: String,
    pub provenance: String,
    pub topic: String,
    pub weight: f32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    pub category: Option<String>,
    pub max_unit_price_krw: Option<u64>,
    pub age_band: Option<String>,
    pub region: Option<String>,
    pub household: Option<String>,
    pub field: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DemographicBands {
    pub age_band: String,
    pub region: String,
    pub household: String,
    pub field: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveQuestionRequest {
    pub question: String,
    #[serde(default = "default_requested_documents")]
    pub requested_documents: usize,
    pub budget_krw: Option<u64>,
    #[serde(default)]
    pub filters: SearchFilters,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Hit,
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionReason {
    CoverageReady,
    NoRelevantDocuments,
    InsufficientCoverage,
    BudgetTooLow,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdown {
    pub relevance: f32,
    pub term_coverage: f32,
    pub authority: f32,
    pub trust: f32,
    pub freshness: f32,
}

/// Payment-safe search metadata. The paid passage is deliberately absent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedDocument {
    pub handle: String,
    pub shelf_id: String,
    pub shelf: String,
    pub category: String,
    pub price_krw: u64,
    pub score: f32,
    pub score_breakdown: ScoreBreakdown,
    pub demographics: Option<DemographicBands>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub currency: &'static str,
    pub document_count: usize,
    pub total_price_krw: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCallDraft {
    pub question: String,
    pub target_answers: usize,
    pub existing_matches: usize,
    pub answers_needed: usize,
    pub suggested_unit_price_krw: u64,
    pub suggested_budget_krw: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveQuestionResponse {
    pub query_id: String,
    /// Returned once by the HTTP API. Only its hash is persisted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_access_token: Option<String>,
    pub decision: Decision,
    pub reason: DecisionReason,
    pub requested_documents: usize,
    pub candidate_count: usize,
    pub matches: Vec<MatchedDocument>,
    pub quote: Option<Quote>,
    pub open_call: Option<OpenCallDraft>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCall {
    pub id: String,
    pub question: String,
    pub unit_price: u64,
    pub target: usize,
    pub answered: usize,
    pub created_at: u64,
    pub chat_id: Option<String>,
    pub mine: bool,
    pub shelf: String,
    pub category: String,
    pub filters: SearchFilters,
    pub eligible: bool,
    pub escrow_remaining_krw: u64,
    pub status: String,
    /// Active answer slots temporarily held by contributors who opened the interview.
    pub reserved_slots: usize,
    /// This viewer's reservation expiry, if they currently hold a slot.
    pub reservation_expires_at: Option<u64>,
    /// Server-side ranking signal. Zero means the viewer is not eligible.
    pub recommendation_score: f32,
    pub recommendation_reason: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCallReservation {
    pub open_call_id: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorNotification {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub open_call_id: Option<String>,
    pub created_at: u64,
    pub read_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsReadRequest {
    #[serde(default)]
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOpenCallRequest {
    pub question: String,
    pub unit_price: u64,
    pub target: usize,
    pub chat_id: Option<String>,
    pub shelf: String,
    pub category: String,
    #[serde(default)]
    pub filters: SearchFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnswerIssue {
    pub rule: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAnswerRequest {
    pub answer: String,
    #[serde(default)]
    pub interview_responses: Vec<InterviewResponse>,
}

/// Optional context collected while easing a respondent into the paid question.
/// These turns stay in the respondent's private memory record; only the final
/// answer is indexed and sold.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InterviewResponse {
    pub question_id: String,
    pub prompt: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub question: String,
    pub answer: String,
    pub shelf: String,
    pub earned: u64,
    pub created_at: u64,
    pub via: String,
    pub status: String,
    pub flags: Vec<AnswerIssue>,
    pub rating: Option<u8>,
    pub dispute_status: Option<String>,
    pub interview_responses: Vec<InterviewResponse>,
    pub memory_type: String,
    pub importance: f32,
    pub reliability_score: f32,
    pub content_hash: String,
    pub version: u32,
    pub locked: bool,
    pub access_count: u64,
    pub last_accessed_at: Option<u64>,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryRequest {
    pub locked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectMemoryRequest {
    pub answer: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryExport {
    pub exported_at: u64,
    pub profile: Option<UserProfile>,
    pub memories: Vec<MemoryEntry>,
    pub access_log: Vec<MemoryAccessEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryAccessEvent {
    pub id: String,
    pub memory_id: Option<String>,
    pub purpose: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorMemoryLink {
    pub id: String,
    pub canonical_url: String,
    pub content_hash: String,
    pub version: u32,
    pub memory_type: String,
    pub importance: f32,
    pub updated_at: u64,
    pub x402_template: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorManifest {
    pub schema: &'static str,
    pub canonical_url: String,
    pub handle: String,
    pub demographics: DemographicBands,
    pub reliability_score: f32,
    pub memory_count: usize,
    pub updated_at: u64,
    pub memories: Vec<ContributorMemoryLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicDocument {
    pub schema: &'static str,
    pub canonical_url: String,
    pub handle: String,
    pub contributor_handle: Option<String>,
    pub shelf: String,
    pub category: String,
    pub content_hash: String,
    pub version: u32,
    pub price_krw: u64,
    pub x402_template: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAnswerResponse {
    pub order: OpenCall,
    pub memory: MemoryEntry,
    pub issues: Vec<AnswerIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountControls {
    pub strikes: usize,
    pub dispute_used: bool,
    pub suspended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub handle: String,
    pub age_band: String,
    pub region: String,
    pub household: String,
    pub field: String,
    pub years: String,
    pub speaks_to: Vec<String>,
    pub strikes: usize,
    pub dispute_used: bool,
    pub suspended: bool,
    pub wallet: Option<String>,
    pub wallet_verified: bool,
    pub wallet_verified_at: Option<u64>,
    pub agreed_at: u64,
    pub consent_version: String,
    pub auto_match: bool,
    pub agents: bool,
    pub browser_alerts: bool,
    pub email_alerts: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProfileRequest {
    pub handle: String,
    pub age_band: String,
    pub region: String,
    pub household: String,
    pub field: String,
    pub years: String,
    pub speaks_to: Vec<String>,
    pub wallet: Option<String>,
    #[serde(default = "default_true")]
    pub auto_match: bool,
    #[serde(default)]
    pub agents: bool,
    #[serde(default)]
    pub browser_alerts: bool,
    #[serde(default)]
    pub email_alerts: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletChallengeRequest {
    pub wallet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletChallenge {
    pub id: String,
    pub wallet: String,
    pub message: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyWalletRequest {
    pub challenge_id: String,
    /// Base58-encoded Ed25519 signature returned by a Solana wallet's signMessage.
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub auto_match: Option<bool>,
    pub agents: Option<bool>,
    pub browser_alerts: Option<bool>,
    pub email_alerts: Option<bool>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarningEvent {
    pub id: String,
    pub settlement_id: Option<String>,
    pub memory_id: Option<String>,
    pub document_handle: Option<String>,
    pub source: String,
    pub amount_krw: u64,
    pub recipient_wallet: Option<String>,
    pub payout_status: String,
    pub available_at: u64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarningsSummary {
    pub accrued_krw: u64,
    pub held_krw: u64,
    pub available_krw: u64,
    pub claimable_krw: u64,
    pub event_count: usize,
    pub events: Vec<EarningEvent>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub handle: String,
    pub shelf: String,
    pub excerpt: String,
    pub price: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeAnswerRequest {
    pub query_id: String,
    pub question: String,
    pub citations: Vec<Citation>,
}

/// Client input for synthesis. The client identifies already-opened passages,
/// while the server reloads the canonical paid evidence before invoking a model.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizePaidAnswerRequest {
    pub query_id: String,
    pub handles: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceContribution {
    pub handle: String,
    pub score: f32,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeAnswerResponse {
    pub answer: String,
    pub confidence: f32,
    pub consensus: Vec<String>,
    pub disagreements: Vec<String>,
    pub used_handles: Vec<String>,
    pub contributions: Vec<EvidenceContribution>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub id: String,
    pub count: usize,
    pub total: u64,
    pub tx_sig: Option<String>,
    pub network: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenDocumentsResponse {
    pub citations: Vec<Citation>,
    pub settlement: Settlement,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentQuote {
    pub id: String,
    pub query_id: String,
    pub document_handle: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub price_krw: u64,
    pub krw_per_usdc: u64,
    pub expires_at: u64,
    pub resource_path: String,
    pub canonical_url: String,
    pub content_hash: String,
    pub document_version: u32,
    pub status: String,
    pub consent_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaidDocument {
    pub quote_id: String,
    pub content_hash: String,
    pub document_version: u32,
    pub delivered_at: u64,
    pub citation: Citation,
}

/// A quote-bound content snapshot returned only to the trusted x402 gateway.
///
/// The gateway needs to build and buffer the success response before the x402
/// middleware settles the transaction. This type deliberately has no delivery
/// timestamp: fetching it neither proves payment nor records buyer access.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentDocumentSnapshot {
    pub quote_id: String,
    pub content_hash: String,
    pub document_version: u32,
    pub citation: Citation,
}

/// Creates one x402 payment resource for an exact set of already-matched
/// documents. The query access token is carried in a header and is never
/// persisted with the quote.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentBundleRequest {
    pub query_id: String,
    pub handles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentBundleQuote {
    pub id: String,
    pub query_id: String,
    pub document_handles: Vec<String>,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub total_price_krw: u64,
    pub krw_per_usdc: u64,
    pub expires_at: u64,
    pub resource_path: String,
    pub bundle_hash: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentBundleSnapshot {
    pub quote_id: String,
    pub bundle_hash: String,
    pub citations: Vec<Citation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordChainSettlementRequest {
    pub quote_id: String,
    pub transaction_signature: String,
    pub payer: String,
    pub pay_to: String,
    pub amount_atomic: String,
    pub network: String,
    #[serde(default)]
    pub raw_response: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainSettlementReceipt {
    pub id: String,
    pub quote_id: String,
    pub transaction_signature: String,
    pub payer: String,
    pub pay_to: String,
    pub amount_atomic: String,
    pub network: String,
    pub confirmed_at: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentDocumentProgress {
    pub handle: String,
    pub price_krw: u64,
    pub status: String,
    pub quote_id: Option<String>,
    pub quote_expires_at: Option<u64>,
    pub transaction_signature: Option<String>,
    pub network: Option<String>,
    pub settled_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentProgress {
    pub query_id: String,
    pub payer: String,
    pub document_count: usize,
    pub settled_count: usize,
    pub unpaid_count: usize,
    pub total_price_krw: u64,
    pub settled_price_krw: u64,
    pub documents: Vec<PaymentDocumentProgress>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredPaidDocument {
    pub citation: Citation,
    pub settlement: ChainSettlementReceipt,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitDocumentFeedbackRequest {
    /// One of: helpful, not_helpful, report.
    pub outcome: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDocumentFeedbackRequest {
    /// One of: upheld, dismissed.
    pub decision: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFeedback {
    pub id: String,
    pub query_id: String,
    pub document_handle: String,
    pub payer: String,
    pub outcome: String,
    pub reason: Option<String>,
    pub status: String,
    pub review_note: Option<String>,
    pub created_at: u64,
    pub reviewed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccount {
    pub id: String,
    pub email: String,
    pub role: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub age_confirmed_14: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSummary {
    pub currency: &'static str,
    pub available_krw: u64,
    pub reserved_krw: u64,
    pub held_krw: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub user: UserAccount,
    pub balance: BalanceSummary,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitDisputeRequest {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisputeCase {
    pub memory_id: String,
    pub user_id: String,
    pub status: String,
    pub reason: String,
    pub review_note: Option<String>,
    pub created_at: u64,
    pub reviewed_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDisputeRequest {
    pub decision: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAnswer {
    pub id: String,
    pub open_call_id: String,
    pub handle: String,
    pub shelf: String,
    pub excerpt: String,
    pub price: u64,
    pub created_at: u64,
    pub demographics: Option<DemographicBands>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ResolveError {
    #[error("question must contain at least 8 non-whitespace characters")]
    QuestionTooShort,
    #[error("question must be 1000 characters or fewer")]
    QuestionTooLong,
    #[error("requestedDocuments must be between 1 and {MAX_REQUESTED_DOCUMENTS}")]
    InvalidRequestedDocuments,
    #[error("one or more search filters are unsupported")]
    UnsupportedFilter,
}
