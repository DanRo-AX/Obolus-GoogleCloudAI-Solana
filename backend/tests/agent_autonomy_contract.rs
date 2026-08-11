use openshelf_api::{
    domain::{
        AgentRun, AgentStep, AgentStepStatus, AgentTool, Decision, ResolveQuestionRequest,
        SearchFilters,
    },
    search::Resolver,
    seed,
    store::{Store, StoreError},
};
const MAX_QUESTION_CHARS: usize = 1_000;
const MAX_REQUESTED_DOCUMENTS: usize = 20;

/// The planner may decide how to research, but it cannot move money or read
/// private passages. Those capabilities remain behind the existing approval,
/// quote, settlement, and opened-evidence boundaries.
const ALLOWED_RESOLVE_TOOLS: &[&str] = &[
    "search_human_evidence",
    "rank_evidence_bundle",
    "propose_evidence_purchase",
    "propose_hybrid_research",
    "propose_open_call",
    "generate_general_baseline",
    "finish_without_purchase",
];

fn parse_resolve_tool(value: &str) -> Result<AgentTool, &'static str> {
    match value {
        "search_human_evidence" => Ok(AgentTool::SearchHumanEvidence),
        "rank_evidence_bundle" => Ok(AgentTool::RankEvidenceBundle),
        "propose_evidence_purchase" => Ok(AgentTool::ProposeEvidencePurchase),
        "propose_hybrid_research" => Ok(AgentTool::ProposeHybridResearch),
        "propose_open_call" => Ok(AgentTool::ProposeOpenCall),
        "generate_general_baseline" => Ok(AgentTool::GenerateGeneralBaseline),
        "finish_without_purchase" => Ok(AgentTool::FinishWithoutPurchase),
        _ => Err("planner selected a tool outside the resolve allowlist"),
    }
}

#[derive(Debug)]
struct BoundedPlannerInput<'a> {
    question: &'a str,
    requested_documents: usize,
    user_spend_cap_krw: Option<u64>,
    proposed_spend_krw: u64,
}

impl BoundedPlannerInput<'_> {
    fn validate(&self) -> Result<(), &'static str> {
        let question_length = self.question.trim().chars().count();
        if !(8..=MAX_QUESTION_CHARS).contains(&question_length) {
            return Err("question is outside the planner input bound");
        }
        if !(1..=MAX_REQUESTED_DOCUMENTS).contains(&self.requested_documents) {
            return Err("requested document count is outside the planner input bound");
        }
        if self
            .user_spend_cap_krw
            .is_some_and(|cap| self.proposed_spend_krw > cap)
        {
            return Err("planner proposal exceeds the user spend cap");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PurchaseProposal {
    fingerprint: String,
    handles: Vec<String>,
    amount_krw: u64,
    requires_user_approval: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UserApproval {
    fingerprint: String,
    handles: Vec<String>,
    amount_krw: u64,
}

fn authorize_purchase(
    proposal: &PurchaseProposal,
    approval: Option<&UserApproval>,
) -> Result<(), &'static str> {
    if proposal.requires_user_approval {
        let approval = approval.ok_or("payment requires explicit user approval")?;
        if approval.fingerprint != proposal.fingerprint
            || approval.handles != proposal.handles
            || approval.amount_krw != proposal.amount_krw
        {
            return Err("approval does not match the immutable purchase proposal");
        }
    }
    Ok(())
}

fn deterministic_next_actions(decision: Decision, has_partial_coverage: bool) -> Vec<AgentTool> {
    match (decision, has_partial_coverage) {
        (Decision::Hit, _) => vec![
            AgentTool::RankEvidenceBundle,
            AgentTool::ProposeEvidencePurchase,
        ],
        (Decision::Miss, true) => vec![
            AgentTool::GenerateGeneralBaseline,
            AgentTool::ProposeHybridResearch,
        ],
        (Decision::Miss, false) => vec![
            AgentTool::GenerateGeneralBaseline,
            AgentTool::ProposeOpenCall,
        ],
    }
}

#[derive(Debug, PartialEq, Eq)]
struct PlannerSelection {
    status: AgentStepStatus,
    actions: Vec<AgentTool>,
}

fn select_or_fallback(
    planner_output: Result<Vec<&str>, &'static str>,
    decision: Decision,
    has_partial_coverage: bool,
) -> PlannerSelection {
    let selected = planner_output.and_then(|names| {
        if names.is_empty() {
            return Err("planner returned no next action");
        }
        names.into_iter().map(parse_resolve_tool).collect()
    });

    match selected {
        Ok(actions) => PlannerSelection {
            status: AgentStepStatus::Completed,
            actions,
        },
        Err(_) => PlannerSelection {
            status: AgentStepStatus::Fallback,
            actions: deterministic_next_actions(decision, has_partial_coverage),
        },
    }
}

#[test]
fn resolve_planner_accepts_only_the_reviewed_non_payment_tool_set() {
    for name in ALLOWED_RESOLVE_TOOLS {
        assert_eq!(parse_resolve_tool(name).unwrap().as_str(), *name);
    }
    for forbidden in [
        "execute_payment",
        "open_private_passage",
        "synthesize_paid_evidence",
        "transfer_usdc",
        "shell",
    ] {
        assert!(parse_resolve_tool(forbidden).is_err(), "{forbidden}");
    }
}

#[test]
fn planner_arguments_are_bounded_by_product_and_user_limits() {
    BoundedPlannerInput {
        question: "What do Paris residents actually choose for dinner?",
        requested_documents: 5,
        user_spend_cap_krw: Some(100),
        proposed_spend_krw: 75,
    }
    .validate()
    .unwrap();

    assert!(
        BoundedPlannerInput {
            question: "short",
            requested_documents: 5,
            user_spend_cap_krw: Some(100),
            proposed_spend_krw: 75,
        }
        .validate()
        .is_err()
    );
    assert!(
        BoundedPlannerInput {
            question: "What do Paris residents actually choose for dinner?",
            requested_documents: MAX_REQUESTED_DOCUMENTS + 1,
            user_spend_cap_krw: Some(100),
            proposed_spend_krw: 75,
        }
        .validate()
        .is_err()
    );
    assert!(
        BoundedPlannerInput {
            question: "What do Paris residents actually choose for dinner?",
            requested_documents: 5,
            user_spend_cap_krw: Some(100),
            proposed_spend_krw: 101,
        }
        .validate()
        .is_err()
    );
}

#[test]
fn hit_and_miss_observations_have_deterministic_safe_fallback_actions() {
    let resolver = Resolver::new(seed::documents());
    let hit = resolver
        .resolve(ResolveQuestionRequest {
            question: "What do Paris residents actually choose for dinner?".to_owned(),
            requested_documents: 1,
            budget_krw: Some(100),
            filters: SearchFilters::default(),
        })
        .unwrap();
    assert_eq!(hit.decision, Decision::Hit);
    assert_eq!(
        deterministic_next_actions(hit.decision, false),
        vec![
            AgentTool::RankEvidenceBundle,
            AgentTool::ProposeEvidencePurchase,
        ]
    );

    let miss = resolver
        .resolve(ResolveQuestionRequest {
            question: "What do residents on Europa Station Zeta-99 buy after midnight?".to_owned(),
            requested_documents: 3,
            budget_krw: Some(100),
            filters: SearchFilters::default(),
        })
        .unwrap();
    assert_eq!(miss.decision, Decision::Miss);
    assert!(miss.matches.is_empty());
    assert_eq!(
        deterministic_next_actions(miss.decision, false),
        vec![
            AgentTool::GenerateGeneralBaseline,
            AgentTool::ProposeOpenCall,
        ]
    );
}

#[test]
fn planner_failure_or_invalid_tool_uses_a_deterministic_fallback() {
    let failed = select_or_fallback(Err("model unavailable"), Decision::Hit, false);
    assert_eq!(failed.status, AgentStepStatus::Fallback);
    assert_eq!(
        failed.actions,
        vec![
            AgentTool::RankEvidenceBundle,
            AgentTool::ProposeEvidencePurchase,
        ]
    );

    let unsafe_selection = select_or_fallback(
        Ok(vec!["search_human_evidence", "execute_payment"]),
        Decision::Miss,
        false,
    );
    assert_eq!(unsafe_selection.status, AgentStepStatus::Fallback);
    assert_eq!(
        unsafe_selection.actions,
        vec![
            AgentTool::GenerateGeneralBaseline,
            AgentTool::ProposeOpenCall,
        ]
    );
}

#[test]
fn purchase_cannot_cross_the_economic_boundary_without_an_exact_approval() {
    let proposal = PurchaseProposal {
        fingerprint: "query-1:PARISR_12:15".to_owned(),
        handles: vec!["PARISR_12".to_owned()],
        amount_krw: 15,
        requires_user_approval: true,
    };
    assert!(authorize_purchase(&proposal, None).is_err());
    assert!(
        authorize_purchase(
            &proposal,
            Some(&UserApproval {
                fingerprint: proposal.fingerprint.clone(),
                handles: proposal.handles.clone(),
                amount_krw: 16,
            }),
        )
        .is_err()
    );
    authorize_purchase(
        &proposal,
        Some(&UserApproval {
            fingerprint: proposal.fingerprint.clone(),
            handles: proposal.handles.clone(),
            amount_krw: proposal.amount_krw,
        }),
    )
    .unwrap();
}

#[test]
fn synthesis_store_boundary_rejects_an_unpaid_passage_even_with_query_access() {
    let store = Store::in_memory().unwrap();
    let query_token_hash = "a".repeat(64);
    let response = Resolver::new(Vec::new())
        .resolve(ResolveQuestionRequest {
            question: "What do Paris residents actually choose for dinner?".to_owned(),
            requested_documents: 1,
            budget_krw: Some(100),
            filters: SearchFilters::default(),
        })
        .unwrap();
    store
        .record_resolution(
            "What do Paris residents actually choose for dinner?",
            &response,
            Some(&query_token_hash),
        )
        .unwrap();

    let error = store
        .opened_evidence(
            &response.query_id,
            &["PARISR_12".to_owned()],
            &query_token_hash,
        )
        .unwrap_err();
    assert!(
        matches!(error, StoreError::DocumentNotQuoted),
        "unexpected boundary error: {error:?}"
    );
}

#[test]
fn public_trace_contract_contains_outcomes_not_private_reasoning() {
    let trace = AgentRun {
        id: "agent_run_1".to_owned(),
        objective: "Resolve a bounded human-evidence question".to_owned(),
        model: "deterministic-fallback".to_owned(),
        mode: "fallback".to_owned(),
        steps: vec![AgentStep {
            sequence: 1,
            agent: "coverage_agent".to_owned(),
            tool: AgentTool::SearchHumanEvidence,
            status: AgentStepStatus::Completed,
            summary: "Coverage search completed".to_owned(),
            artifact_ref: Some("coverage_query_1".to_owned()),
        }],
        next_action: AgentTool::ProposeOpenCall,
        requires_user_approval: false,
    };
    let json = serde_json::to_string(&trace).unwrap();
    assert!(json.contains(r#""tool":"search_human_evidence""#));
    assert!(json.contains(r#""status":"completed""#));
    assert!(json.contains(r#""artifactRef":"coverage_query_1""#));
    for forbidden in [
        "chainOfThought",
        "chain_of_thought",
        "reasoning",
        "rationale",
        "prompt",
        "modelResponse",
    ] {
        assert!(!json.contains(forbidden));
    }
}
