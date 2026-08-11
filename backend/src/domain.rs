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

/// Human supply and AI liquidity are deliberately separate. This state is
/// computed only from human documents; an AI baseline can never promote a
/// question into a covered state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiquidityState {
    AiLiquidityOnly,
    HybridCoverage,
    HumanCovered,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBaselineDraft {
    pub orientation: String,
    pub general_points: Vec<String>,
    pub human_gaps: Vec<String>,
    pub questions_for_people: Vec<String>,
}

/// An ephemeral, zero-price market-liquidity response. It is not a Document,
/// cannot enter ranking/authority/memory, and never counts toward a call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBaseline {
    pub id: String,
    pub query_id: String,
    pub kind: &'static str,
    pub orientation: String,
    pub general_points: Vec<String>,
    pub human_gaps: Vec<String>,
    pub questions_for_people: Vec<String>,
    pub model: String,
    pub mode: String,
    pub policy_version: String,
    pub generated_at: u64,
    pub expires_at: u64,
    pub price_krw: u64,
    pub sellable: bool,
    pub counts_as_human_coverage: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiBaselineResponse {
    pub status: &'static str,
    pub baseline: Option<AiBaseline>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfStarterDraft {
    pub prompt: String,
    pub rationale: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfStarter {
    pub id: String,
    pub prompt: String,
    pub rationale: String,
    pub category: String,
    pub source: &'static str,
    pub buyer_waiting: bool,
    pub guaranteed_reward_krw: u64,
    pub generated_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateShelfStartersResponse {
    pub status: &'static str,
    pub starters: Vec<ShelfStarter>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiLiquidityMetrics {
    pub total_queries: u64,
    pub ai_liquidity_only_queries: u64,
    pub hybrid_coverage_queries: u64,
    pub human_covered_queries: u64,
    pub baselines_generated: u64,
    pub active_baselines: u64,
    pub shelf_starters_generated: u64,
    pub shelf_starters_answered: u64,
    pub human_documents: u64,
    pub open_human_calls: u64,
    pub priced_ai_documents: u64,
    pub ai_authority_edges: u64,
    pub starter_to_human_document_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationsStatusCount {
    pub status: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceOperationsMetrics {
    pub human_documents: u64,
    pub independent_contributors: u64,
    pub open_calls: u64,
    pub filled_calls: u64,
    pub pending_disputes: u64,
    pub pending_document_reports: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettlementOperationsMetrics {
    pub payment_quotes: Vec<OperationsStatusCount>,
    pub research_jobs: Vec<OperationsStatusCount>,
    pub research_payment_attempts: Vec<OperationsStatusCount>,
    pub direct_payment_attempts: Vec<OperationsStatusCount>,
    pub payout_claims: Vec<OperationsStatusCount>,
    pub unresolved_payment_attempts: u64,
    pub oldest_unresolved_payment_at: Option<u64>,
}

/// Aggregate-only operational state for the read-first admin console. It
/// deliberately contains no document text, wallet address, credential,
/// signature, session token, or per-user identifier.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdminOperationsSnapshot {
    pub generated_at: u64,
    pub marketplace: MarketplaceOperationsMetrics,
    pub settlements: SettlementOperationsMetrics,
    pub ai_liquidity: AiLiquidityMetrics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitShelfStarterAnswerRequest {
    pub answer: String,
    pub price_krw: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitShelfStarterAnswerResponse {
    pub memory: MemoryEntry,
    pub document_handle: String,
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

/// A bounded action that one of Obulus's cooperating agents may expose in an
/// execution trace.  Payment and private-evidence access are intentionally not
/// planner tools: those remain deterministic server operations gated by an
/// explicit user approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTool {
    SearchHumanEvidence,
    RankEvidenceBundle,
    ProposeEvidencePurchase,
    ProposeHybridResearch,
    ProposeOpenCall,
    GenerateGeneralBaseline,
    FinishWithoutPurchase,
}

impl AgentTool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SearchHumanEvidence => "search_human_evidence",
            Self::RankEvidenceBundle => "rank_evidence_bundle",
            Self::ProposeEvidencePurchase => "propose_evidence_purchase",
            Self::ProposeHybridResearch => "propose_hybrid_research",
            Self::ProposeOpenCall => "propose_open_call",
            Self::GenerateGeneralBaseline => "generate_general_baseline",
            Self::FinishWithoutPurchase => "finish_without_purchase",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepStatus {
    Completed,
    Fallback,
    AwaitingUserApproval,
}

impl AgentStepStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Fallback => "fallback",
            Self::AwaitingUserApproval => "awaiting_user_approval",
        }
    }
}

/// Auditable orchestration metadata. `summary` is a short operational result,
/// never hidden chain-of-thought or a model transcript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub sequence: usize,
    pub agent: String,
    pub tool: AgentTool,
    pub status: AgentStepStatus,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    pub objective: String,
    pub model: String,
    pub mode: String,
    pub provider_call_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_revision: Option<String>,
    pub steps: Vec<AgentStep>,
    pub next_action: AgentTool,
    pub requires_user_approval: bool,
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
    pub liquidity_state: LiquidityState,
    pub ai_baseline_eligible: bool,
    pub requested_documents: usize,
    pub candidate_count: usize,
    pub matches: Vec<MatchedDocument>,
    pub quote: Option<Quote>,
    pub open_call: Option<OpenCallDraft>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_run: Option<AgentRun>,
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
    pub escrow_mode: String,
    pub escrow_wallet: Option<String>,
    pub escrow_asset: Option<String>,
    pub escrow_network: Option<String>,
    pub escrow_total_atomic: Option<String>,
    pub escrow_remaining_atomic: Option<String>,
    pub funding_transaction_signature: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenCallFundingQuote {
    pub id: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub total_price_krw: u64,
    pub krw_per_usdc: u64,
    pub expires_at: u64,
    pub resource_path: String,
    pub payload_hash: String,
    pub status: String,
    pub open_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCallFundingSnapshot {
    pub quote_id: String,
    pub question: String,
    pub target: usize,
    pub unit_price_krw: u64,
    pub total_price_krw: u64,
    pub payload_hash: String,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletAuthVerifyRequest {
    pub wallet: String,
    pub challenge_id: String,
    /// Base58-encoded Ed25519 signature returned by a Solana wallet's signMessage.
    pub signature: String,
    #[serde(default)]
    pub age_confirmed_14: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletChallenge {
    pub id: String,
    pub wallet: String,
    pub message: String,
    pub expires_at: u64,
}

/// A one-time x402 sign-in resource used to prove ownership of the local
/// Pay.sh wallet without exporting its private key.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletSiwxLink {
    pub id: String,
    pub resource_url: String,
    pub network: String,
    pub expires_at: u64,
}

/// Signed `SIGN-IN-WITH-X` payload produced by Pay.sh. The server reconstructs
/// the canonical Sign-In With Solana message and verifies its Ed25519 signature.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiwxPayload {
    pub domain: String,
    pub address: String,
    pub uri: String,
    pub statement: Option<String>,
    pub version: String,
    pub chain_id: String,
    pub nonce: String,
    pub issued_at: String,
    pub expiration_time: Option<String>,
    pub not_before: Option<String>,
    pub request_id: Option<String>,
    pub resources: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub signature_type: String,
    pub signature_scheme: Option<String>,
    pub signature: String,
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
    pub payout_claim_id: Option<String>,
    pub payout_claim_status: Option<String>,
    pub payout_transaction_signature: Option<String>,
    pub payout_amount_atomic: Option<String>,
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

/// One exact transfer owed by the server-managed Devnet escrow.
///
/// A claim is prepared before broadcast. Persisting the signed transaction
/// makes a worker crash replay the same Solana signature instead of paying a
/// contributor twice.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PayoutClaim {
    pub id: String,
    pub earning_event_id: Option<String>,
    pub open_call_id: Option<String>,
    pub beneficiary_user_id: String,
    pub kind: String,
    pub escrow_wallet: String,
    pub recipient_wallet: String,
    pub asset: String,
    pub network: String,
    pub amount_atomic: String,
    pub amount_krw: u64,
    pub status: String,
    pub transaction_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_transaction_base64: Option<String>,
    pub recent_blockhash: Option<String>,
    pub last_valid_block_height: Option<u64>,
    pub absence_observed_at: Option<u64>,
    pub attempt_count: u32,
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub confirmed_at: Option<u64>,
}

/// Unconfirmed payout work grouped by the exact escrow signer that can move it.
/// This is an operational safety view: a replacement worker must not report
/// ready while an old KMS wallet still owns durable payout work.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PayoutClaimBacklog {
    pub escrow_wallet: String,
    pub network: String,
    pub claim_count: u64,
    pub prepared_count: u64,
    pub blocked_count: u64,
    pub oldest_created_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeasePayoutClaimsRequest {
    pub worker_id: String,
    pub escrow_wallet: String,
    pub network: String,
    #[serde(default = "default_payout_lease_limit")]
    pub limit: usize,
    #[serde(default = "default_payout_lease_ms")]
    pub lease_ms: u64,
}

fn default_payout_lease_limit() -> usize {
    20
}

fn default_payout_lease_ms() -> u64 {
    60_000
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparePayoutClaimRequest {
    pub worker_id: String,
    pub transaction_signature: String,
    pub signed_transaction_base64: String,
    pub recent_blockhash: String,
    pub last_valid_block_height: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletePayoutClaimRequest {
    pub worker_id: String,
    pub transaction_signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailPayoutClaimRequest {
    pub worker_id: String,
    pub error: String,
    /// Set only after the worker proves the prepared signature is absent and
    /// its blockhash has expired. This permits a safely re-signed retry.
    #[serde(default)]
    pub abandon_prepared_transaction: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub handle: String,
    pub shelf: String,
    pub excerpt: String,
    pub price: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

/// Agent-readable paid resource prepared for the official Pay.sh gateway.
///
/// Pay.sh resolves the runtime `owner_wallet` recipient from the resource URL,
/// charges the exact price band over MPP, and only then proxies the request to
/// the private delivery handler. One atomic unit remains with the gateway's
/// primary recipient because Pay.sh requires every split set to leave a
/// positive primary share.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PayShResource {
    pub quote_id: String,
    pub query_id: String,
    pub document_handle: String,
    pub recipient_wallet: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_amount_atomic: String,
    pub price_krw: u64,
    pub krw_per_usdc: u64,
    pub expires_at: u64,
    pub status: String,
    pub resource_path: String,
    pub recovery_path: String,
    pub protocol: String,
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
    /// Preferred refill size when the verified prepaid wallet cannot cover
    /// this job. The server always raises it to at least the exact deficit.
    pub top_up_atomic: Option<String>,
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
    /// Exact research budget reserved from the prepaid account. `amount_atomic`
    /// is only the Phantom refill required for this quote and can be zero.
    pub budget_atomic: String,
    /// Immutable deficit at quote creation. The browser combines this with its
    /// own requested top-up instead of reinterpreting a later mutable balance.
    pub minimum_deposit_atomic: String,
    pub requires_payment: bool,
    pub available_balance_atomic: String,
    pub total_price_krw: u64,
    pub krw_per_usdc: u64,
    pub expires_at: u64,
    pub resource_path: String,
    pub bundle_hash: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrepaidSessionRequest {
    pub wallet: String,
    pub challenge_id: String,
    /// Base58 Ed25519 signature over the fresh OPENSHELF wallet challenge.
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepaidWalletSession {
    pub token: String,
    pub wallet: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub available_atomic: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepaidBalance {
    pub wallet: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub available_atomic: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrepaidWithdrawalRequest {
    /// Omit to withdraw the full available balance.
    pub amount_atomic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentBundleSnapshot {
    pub quote_id: String,
    pub bundle_hash: String,
    pub citations: Vec<Citation>,
}

/// Durable status for one browser-funded, server-executed research job.
/// The browser pays `amount_atomic` once; the Pay.sh worker then buys each
/// document independently from the same bounded service wallet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchJobStatus {
    pub id: String,
    pub query_id: String,
    pub payer: Option<String>,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub spent_atomic: String,
    pub refundable_atomic: String,
    pub status: String,
    pub transaction_signature: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub citations: Vec<Citation>,
    pub pending_handles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchJobPlan {
    pub id: String,
    pub payer: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub status: String,
    pub resources: Vec<PayShResource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailResearchJobRequest {
    pub error: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginResearchPaymentRequest {
    pub quote_id: String,
    pub attempt_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResearchPaymentRequest {
    pub quote_id: String,
    pub payer: String,
    pub platform_recipient_wallet: String,
    pub challenge_id: String,
    pub external_id: String,
    pub signed_transaction_base64: String,
    pub recent_blockhash: String,
    pub challenge_expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayShChallengeBindingRequest {
    pub challenge_id: String,
    pub external_id: String,
    pub challenge_expires_at: u64,
}

/// One or more MPP challenges issued for an immutable Pay.sh quote. The
/// gateway persists these before returning the upstream 402 to the caller, so
/// a later credential cannot be attached to a different same-price document.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindPayShChallengesRequest {
    pub quote_id: String,
    pub query_id: String,
    pub document_handle: String,
    pub path_price_krw: u64,
    pub owner_wallet: String,
    #[serde(default)]
    pub research_job_id: Option<String>,
    #[serde(default)]
    pub payment_attempt_id: Option<String>,
    pub challenges: Vec<PayShChallengeBindingRequest>,
}

/// Exact MPP credential captured by the public authorization proxy before the
/// official Pay.sh gate is allowed to verify or broadcast it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareDirectPayShPaymentRequest {
    pub quote_id: String,
    pub query_id: String,
    pub document_handle: String,
    pub path_price_krw: u64,
    pub owner_wallet: String,
    pub payer: String,
    pub platform_recipient_wallet: String,
    pub challenge_id: String,
    pub external_id: String,
    pub signed_transaction_base64: String,
    pub recent_blockhash: String,
    pub challenge_expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleResearchPaymentRequest {
    pub transaction_signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeferResearchPaymentRequest {
    #[serde(default)]
    pub absence_observed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseResearchPaymentRequest {
    pub expected_status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPaymentReconciliation {
    pub job_id: String,
    pub quote_id: String,
    pub attempt_id: String,
    pub status: String,
    pub reconcile_after: u64,
    pub created_at: u64,
    pub prepared_at: Option<u64>,
    pub payer: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_amount_atomic: String,
    pub recipient_wallet: String,
    pub platform_recipient_wallet: Option<String>,
    pub signed_transaction_base64: Option<String>,
    pub recent_blockhash: Option<String>,
    pub challenge_id: Option<String>,
    pub external_id: Option<String>,
    pub challenge_expires_at: Option<u64>,
    pub absence_observed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectPayShPaymentReconciliation {
    pub quote_id: String,
    pub attempt_id: String,
    pub status: String,
    pub reconcile_after: u64,
    pub created_at: u64,
    pub prepared_at: u64,
    pub payer: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_amount_atomic: String,
    pub recipient_wallet: String,
    pub platform_recipient_wallet: Option<String>,
    pub signed_transaction_base64: String,
    pub recent_blockhash: String,
    pub challenge_id: String,
    pub external_id: String,
    pub challenge_expires_at: u64,
    pub absence_observed_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordChainSettlementRequest {
    pub quote_id: String,
    #[serde(default)]
    pub attempt_id: Option<String>,
    pub transaction_signature: String,
    pub payer: String,
    pub pay_to: String,
    pub amount_atomic: String,
    pub network: String,
    #[serde(default)]
    pub raw_response: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimPaymentAttemptRequest {
    pub settlement_kind: String,
    pub quote_id: String,
    pub attempt_id: String,
    #[serde(default)]
    pub payer: Option<String>,
    #[serde(default)]
    pub signed_transaction_base64: Option<String>,
    #[serde(default)]
    pub recent_blockhash: Option<String>,
    #[serde(default)]
    pub absence_observed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAttemptFence {
    pub settlement_kind: String,
    pub quote_id: String,
    pub attempt_id: String,
    pub reconcile_after: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAttemptReconciliation {
    pub settlement_kind: String,
    pub quote_id: String,
    pub attempt_id: String,
    pub reconcile_after: u64,
    pub created_at: u64,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub amount_atomic: String,
    pub payer: Option<String>,
    pub signed_transaction_base64: Option<String>,
    pub recent_blockhash: Option<String>,
    pub absence_observed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAttemptRelease {
    pub released: bool,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
    pub token: String,
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
    pub wallet: Option<String>,
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
