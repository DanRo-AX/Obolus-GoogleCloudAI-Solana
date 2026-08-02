use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::authority::personalized_page_rank;
use crate::domain::{
    CATEGORY_IDS, Decision, DecisionReason, Document, EvidenceEdge, MAX_REQUESTED_DOCUMENTS,
    MatchedDocument, OpenCallDraft, Quote, ResolveError, ResolveQuestionRequest,
    ResolveQuestionResponse, ScoreBreakdown,
};

const EMBEDDING_DIMENSIONS: usize = 768;
const MIN_RELEVANCE: f32 = 0.22;
const DEFAULT_OPEN_CALL_PRICE_KRW: u64 = 500;
static QUERY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
struct IndexedDocument {
    document: Document,
    embedding: Vec<f32>,
    terms: HashSet<String>,
}

#[derive(Debug)]
pub struct Resolver {
    documents: Vec<IndexedDocument>,
    document_frequency: HashMap<String, usize>,
    evidence_edges: Vec<EvidenceEdge>,
}

#[derive(Debug)]
struct Candidate<'a> {
    indexed: &'a IndexedDocument,
    score: f32,
    breakdown: ScoreBreakdown,
}

impl Resolver {
    pub fn new(documents: Vec<Document>) -> Self {
        let documents = documents
            .into_iter()
            .map(|document| {
                let searchable = searchable_text(&document);
                IndexedDocument {
                    embedding: embed(&searchable),
                    terms: word_terms(&searchable).into_iter().collect(),
                    document,
                }
            })
            .collect::<Vec<_>>();
        let mut document_frequency = HashMap::new();
        for indexed in &documents {
            for term in &indexed.terms {
                *document_frequency.entry(term.clone()).or_default() += 1;
            }
        }
        Self {
            documents,
            document_frequency,
            evidence_edges: Vec::new(),
        }
    }

    pub fn with_evidence_edges(mut self, evidence_edges: Vec<EvidenceEdge>) -> Self {
        self.evidence_edges = evidence_edges;
        self
    }

    pub fn resolve(
        &self,
        request: ResolveQuestionRequest,
    ) -> Result<ResolveQuestionResponse, ResolveError> {
        validate(&request)?;

        let question = request.question.trim().to_owned();
        let query_embedding = embed(&question);
        let query_terms: HashSet<String> = word_terms(&question).into_iter().collect();
        // Named places and specific topics are anchors. At least one must match,
        // otherwise generic words such as "daily" can pull in the wrong shelf.
        // In the local lexical index, terms present in more than roughly 20%
        // of the corpus are too broad to identify a shelf on their own.
        let rare_cutoff = (self.documents.len() / 5).max(3);
        let mut anchor_terms = capitalised_terms(&question)
            .into_iter()
            .filter(|term| self.document_frequency.contains_key(term))
            .collect::<HashSet<_>>();
        if anchor_terms.is_empty() {
            anchor_terms = query_terms
                .iter()
                .filter(|term| {
                    self.document_frequency
                        .get(*term)
                        .is_some_and(|frequency| *frequency <= rare_cutoff)
                })
                .cloned()
                .collect();
        }
        if anchor_terms.is_empty() {
            anchor_terms = query_terms
                .iter()
                .filter(|term| self.document_frequency.contains_key(*term))
                .cloned()
                .collect();
        }
        let authority = self.authority_scores(&query_embedding, &query_terms);
        let mut candidates = self
            .documents
            .iter()
            .filter(|indexed| !indexed.document.locked)
            .filter(|indexed| category_matches(indexed, request.filters.category.as_deref()))
            .filter(|indexed| demographics_match(&indexed.document, &request.filters))
            .filter(|indexed| {
                request
                    .filters
                    .max_unit_price_krw
                    .is_none_or(|max| indexed.document.price_krw <= max)
            })
            .filter_map(|indexed| {
                score(
                    indexed,
                    &query_embedding,
                    &query_terms,
                    &anchor_terms,
                    authority.get(&indexed.document.id).copied().unwrap_or(0.5),
                )
            })
            .collect::<Vec<_>>();

        candidates.sort_by(|left, right| {
            right.score.total_cmp(&left.score).then_with(|| {
                left.indexed
                    .document
                    .handle
                    .cmp(&right.indexed.document.handle)
            })
        });
        let candidate_count = candidates.len();

        // Optimise the whole bundle. Selection prefers independent authors and
        // penalises redundant passages instead of spending greedily on the
        // first expensive result.
        let selected =
            select_candidate_indices(&candidates, request.requested_documents, request.budget_krw);
        let mut spent = 0_u64;
        let budget_blocked =
            request.budget_krw.is_some() && !candidates.is_empty() && selected.is_empty();
        let mut matches = Vec::new();
        for index in selected {
            let candidate = &candidates[index];
            let document = &candidate.indexed.document;
            spent += document.price_krw;
            matches.push(MatchedDocument {
                handle: document.handle.clone(),
                shelf_id: document.shelf_id.clone(),
                shelf: document.shelf.clone(),
                category: document.category.clone(),
                price_krw: document.price_krw,
                score: rounded(candidate.score),
                score_breakdown: ScoreBreakdown {
                    relevance: rounded(candidate.breakdown.relevance),
                    term_coverage: rounded(candidate.breakdown.term_coverage),
                    authority: rounded(candidate.breakdown.authority),
                    trust: rounded(candidate.breakdown.trust),
                    freshness: rounded(candidate.breakdown.freshness),
                },
                demographics: document.demographics.clone(),
            });
        }

        let enough = matches.len() >= request.requested_documents;
        let (decision, reason) = if enough {
            (Decision::Hit, DecisionReason::CoverageReady)
        } else if candidate_count == 0 {
            (Decision::Miss, DecisionReason::NoRelevantDocuments)
        } else if matches.is_empty() && budget_blocked {
            (Decision::Miss, DecisionReason::BudgetTooLow)
        } else {
            (Decision::Miss, DecisionReason::InsufficientCoverage)
        };

        let quote = (!matches.is_empty()).then_some(Quote {
            currency: "KRW",
            document_count: matches.len(),
            total_price_krw: spent,
        });
        let open_call = (decision == Decision::Miss).then(|| {
            let suggested_unit_price_krw = suggested_price(&matches);
            let answers_needed = request.requested_documents.saturating_sub(matches.len());
            OpenCallDraft {
                question: question.clone(),
                target_answers: request.requested_documents,
                existing_matches: matches.len(),
                answers_needed,
                suggested_unit_price_krw,
                suggested_budget_krw: suggested_unit_price_krw * answers_needed as u64,
            }
        });

        Ok(ResolveQuestionResponse {
            query_id: query_id(&question),
            payment_access_token: None,
            decision,
            reason,
            requested_documents: request.requested_documents,
            candidate_count,
            matches,
            quote,
            open_call,
        })
    }

    fn authority_scores(
        &self,
        query_embedding: &[f32],
        query_terms: &HashSet<String>,
    ) -> HashMap<String, f32> {
        if self.evidence_edges.is_empty() {
            return HashMap::new();
        }

        let mut teleport = HashMap::new();
        let node_ids = self
            .documents
            .iter()
            .map(|indexed| {
                let relevance = cosine(query_embedding, &indexed.embedding).max(0.0);
                let coverage = if query_terms.is_empty() {
                    0.0
                } else {
                    query_terms
                        .iter()
                        .filter(|term| indexed.terms.contains(*term))
                        .count() as f32
                        / query_terms.len() as f32
                };
                let trust =
                    (indexed.document.quality_score + indexed.document.reliability_score) / 2.0;
                // Query relevance controls where the random walk restarts. A
                // small verified-trust floor prevents disconnected documents
                // from receiving a literal zero probability.
                teleport.insert(
                    indexed.document.id.clone(),
                    relevance.powi(2) + coverage * 0.5 + trust * 0.02,
                );
                indexed.document.id.clone()
            })
            .collect::<Vec<_>>();
        let topical_edges = self
            .evidence_edges
            .iter()
            .filter(|edge| {
                let topic_terms = word_terms(&edge.topic);
                topic_terms.is_empty() || topic_terms.iter().any(|term| query_terms.contains(term))
            })
            .cloned()
            .collect::<Vec<_>>();
        let raw = personalized_page_rank(&node_ids, &topical_edges, &teleport);
        let maximum = raw.values().copied().fold(0.0_f32, f32::max);
        if maximum <= f32::EPSILON {
            return HashMap::new();
        }
        raw.into_iter()
            .map(|(id, score)| (id, score / maximum))
            .collect()
    }
}

#[derive(Clone)]
struct SelectionState {
    spent: u64,
    utility: f32,
    indices: Vec<usize>,
}

fn select_candidate_indices(
    candidates: &[Candidate<'_>],
    requested: usize,
    budget: Option<u64>,
) -> Vec<usize> {
    let mut authors = HashSet::new();
    let unique = candidates
        .iter()
        .enumerate()
        .filter_map(|(index, candidate)| {
            authors
                .insert(candidate.indexed.document.author_id.as_str())
                .then_some(index)
        })
        .take(80)
        .collect::<Vec<_>>();
    let Some(budget) = budget else {
        let mut chosen = Vec::new();
        while chosen.len() < requested {
            let next = unique
                .iter()
                .copied()
                .filter(|index| !chosen.contains(index))
                .max_by(|left, right| {
                    marginal_utility(candidates, *left, &chosen)
                        .total_cmp(&marginal_utility(candidates, *right, &chosen))
                });
            let Some(next) = next else { break };
            chosen.push(next);
        }
        return chosen;
    };

    let mut states = vec![Vec::<SelectionState>::new(); requested + 1];
    states[0].push(SelectionState {
        spent: 0,
        utility: 0.0,
        indices: Vec::new(),
    });
    for index in unique {
        let price = candidates[index].indexed.document.price_krw;
        for count in (0..requested).rev() {
            let additions = states[count]
                .iter()
                .filter_map(|state| {
                    let spent = state.spent.checked_add(price)?;
                    (spent <= budget).then(|| SelectionState {
                        spent,
                        utility: state.utility
                            + marginal_utility(candidates, index, &state.indices),
                        indices: state
                            .indices
                            .iter()
                            .copied()
                            .chain(std::iter::once(index))
                            .collect(),
                    })
                })
                .collect::<Vec<_>>();
            states[count + 1].extend(additions);
            prune_states(&mut states[count + 1]);
        }
    }
    states
        .into_iter()
        .rev()
        .find_map(|bucket| {
            bucket
                .into_iter()
                .max_by(|left, right| left.utility.total_cmp(&right.utility))
                .map(|state| state.indices)
        })
        .unwrap_or_default()
}

fn marginal_utility(candidates: &[Candidate<'_>], index: usize, chosen: &[usize]) -> f32 {
    let terms = &candidates[index].indexed.terms;
    let redundancy = chosen
        .iter()
        .map(|other| jaccard(terms, &candidates[*other].indexed.terms))
        .fold(0.0_f32, f32::max);
    candidates[index].score - redundancy * 0.18
}

fn jaccard(left: &HashSet<String>, right: &HashSet<String>) -> f32 {
    let union = left.union(right).count();
    if union == 0 {
        0.0
    } else {
        left.intersection(right).count() as f32 / union as f32
    }
}

fn prune_states(states: &mut Vec<SelectionState>) {
    states.sort_by(|left, right| {
        left.spent
            .cmp(&right.spent)
            .then_with(|| right.utility.total_cmp(&left.utility))
    });
    let mut best = f32::NEG_INFINITY;
    states.retain(|state| {
        if state.utility > best + 0.0001 {
            best = state.utility;
            true
        } else {
            false
        }
    });
    if states.len() > 512 {
        states.sort_by(|left, right| right.utility.total_cmp(&left.utility));
        states.truncate(512);
    }
}

fn validate(request: &ResolveQuestionRequest) -> Result<(), ResolveError> {
    let question = request.question.trim();
    if question.chars().count() < 8 {
        return Err(ResolveError::QuestionTooShort);
    }
    if question.chars().count() > 1000 {
        return Err(ResolveError::QuestionTooLong);
    }
    if !(1..=MAX_REQUESTED_DOCUMENTS).contains(&request.requested_documents) {
        return Err(ResolveError::InvalidRequestedDocuments);
    }
    let filters = &request.filters;
    if filters
        .category
        .as_deref()
        .is_some_and(|value| !CATEGORY_IDS.contains(&value))
        || filters.age_band.as_deref().is_some_and(|value| {
            !["under-25", "25-34", "35-44", "45-54", "55-plus"].contains(&value)
        })
        || filters
            .region
            .as_deref()
            .is_some_and(|value| !["seoul", "gyeonggi", "metro", "town", "abroad"].contains(&value))
        || filters.household.as_deref().is_some_and(|value| {
            !["alone", "partner", "kids", "parents", "shared"].contains(&value)
        })
        || filters.field.as_deref().is_some_and(|value| {
            ![
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
            ]
            .contains(&value)
        })
    {
        return Err(ResolveError::UnsupportedFilter);
    }
    Ok(())
}

fn category_matches(indexed: &IndexedDocument, requested: Option<&str>) -> bool {
    requested.is_none_or(|category| indexed.document.category.eq_ignore_ascii_case(category))
}

fn demographics_match(document: &Document, filters: &crate::domain::SearchFilters) -> bool {
    let targeted = filters.age_band.is_some()
        || filters.region.is_some()
        || filters.household.is_some()
        || filters.field.is_some();
    if !targeted {
        return true;
    }
    let Some(bands) = document.demographics.as_ref() else {
        return false;
    };
    filters
        .age_band
        .as_deref()
        .is_none_or(|value| bands.age_band == value)
        && filters
            .region
            .as_deref()
            .is_none_or(|value| bands.region == value)
        && filters
            .household
            .as_deref()
            .is_none_or(|value| bands.household == value)
        && filters
            .field
            .as_deref()
            .is_none_or(|value| bands.field == value)
}

fn searchable_text(document: &Document) -> String {
    format!(
        "{} {} {} {} {} {}",
        document.shelf,
        document.shelf,
        document.category,
        document.tags.join(" "),
        document.tags.join(" "),
        document.content,
    )
}

fn score<'a>(
    indexed: &'a IndexedDocument,
    query_embedding: &[f32],
    query_terms: &HashSet<String>,
    anchor_terms: &HashSet<String>,
    authority: f32,
) -> Option<Candidate<'a>> {
    let relevance = cosine(query_embedding, &indexed.embedding);
    let term_coverage = if query_terms.is_empty() {
        0.0
    } else {
        query_terms
            .iter()
            .filter(|term| indexed.terms.contains(*term))
            .count() as f32
            / query_terms.len() as f32
    };
    let trust = (indexed.document.quality_score + indexed.document.reliability_score) / 2.0;
    let freshness = (2.0_f32)
        .powf(-(indexed.document.age_days as f32) / 90.0)
        .max(0.2);

    // Relevance gates eligibility. Trust and freshness only order relevant MDs;
    // a popular recent document cannot match an unrelated question.
    let has_anchor = anchor_terms.iter().any(|term| indexed.terms.contains(term));
    if relevance < MIN_RELEVANCE || term_coverage == 0.0 || !has_anchor {
        return None;
    }
    let final_score = relevance * 0.60
        + term_coverage * 0.12
        + authority * 0.13
        + trust * 0.10
        + freshness * 0.05;
    Some(Candidate {
        indexed,
        score: final_score,
        breakdown: ScoreBreakdown {
            relevance,
            term_coverage,
            authority,
            trust,
            freshness,
        },
    })
}

fn suggested_price(matches: &[MatchedDocument]) -> u64 {
    if matches.is_empty() {
        return DEFAULT_OPEN_CALL_PRICE_KRW;
    }
    let mut prices = matches
        .iter()
        .map(|item| item.price_krw)
        .collect::<Vec<_>>();
    prices.sort_unstable();
    prices[prices.len() / 2]
}

fn rounded(value: f32) -> f32 {
    (value * 10_000.0).round() / 10_000.0
}

fn query_id(question: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is before Unix epoch")
        .as_nanos();
    let counter = QUERY_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "qry_{timestamp:x}_{:x}_{counter:x}",
        fnv1a(question.as_bytes())
    )
}

fn embed(text: &str) -> Vec<f32> {
    let mut vector = vec![0.0_f32; EMBEDDING_DIMENSIONS];
    for (feature, weight) in features(text) {
        let index = fnv1a(feature.as_bytes()) as usize % EMBEDDING_DIMENSIONS;
        vector[index] += weight;
    }
    let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if magnitude > 0.0 {
        for value in &mut vector {
            *value /= magnitude;
        }
    }
    vector
}

fn cosine(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn features(text: &str) -> Vec<(String, f32)> {
    let mut counts = HashMap::<String, f32>::new();
    for term in word_terms(text) {
        *counts.entry(format!("w:{term}")).or_default() += 2.0;
        let characters = term.chars().collect::<Vec<_>>();
        for width in [2, 3] {
            if characters.len() < width {
                continue;
            }
            for window in characters.windows(width) {
                let gram = window.iter().collect::<String>();
                *counts.entry(format!("g{width}:{gram}")).or_default() += 0.35;
            }
        }
    }
    counts.into_iter().collect()
}

fn word_terms(text: &str) -> Vec<String> {
    let normalised = text
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() || ('가'..='힣').contains(&character) {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();

    normalised
        .split_whitespace()
        .filter(|term| {
            let length = term.chars().count();
            if term.is_ascii() {
                length >= 3
            } else {
                length >= 2
            }
        })
        .filter(|term| !is_stopword(term))
        .map(canonical_term)
        .collect()
}

fn canonical_term(term: &str) -> String {
    if !term.is_ascii() {
        for (needle, canonical) in [
            ("파리", "paris"),
            ("음식", "food"),
            ("요리", "food"),
            ("식당", "restaurant"),
            ("점심", "lunch"),
            ("저녁", "dinner"),
            ("여행", "travel"),
            ("가격", "price"),
            ("비용", "cost"),
            ("선호", "preference"),
            ("좋아", "preference"),
        ] {
            if term.contains(needle) {
                return canonical.to_owned();
            }
        }
        return term.to_owned();
    }
    if term == "paris" {
        return term.to_owned();
    }
    if term.len() > 5
        && let Some(stem) = term.strip_suffix("ies")
    {
        return format!("{stem}y");
    }
    if term.len() > 4
        && !term.ends_with("ss")
        && let Some(stem) = term.strip_suffix('s')
    {
        return stem.to_owned();
    }
    term.to_owned()
}

fn capitalised_terms(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .filter_map(|raw| {
            let trimmed = raw.trim_matches(|character: char| !character.is_alphanumeric());
            trimmed
                .chars()
                .next()
                .is_some_and(char::is_uppercase)
                .then(|| canonical_term(&trimmed.to_lowercase()))
        })
        .filter(|term| !is_stopword(term))
        .collect()
}

fn is_stopword(term: &str) -> bool {
    matches!(
        term,
        "about"
            | "after"
            | "also"
            | "and"
            | "are"
            | "for"
            | "from"
            | "have"
            | "how"
            | "has"
            | "had"
            | "his"
            | "into"
            | "its"
            | "not"
            | "our"
            | "people"
            | "she"
            | "that"
            | "the"
            | "their"
            | "them"
            | "this"
            | "what"
            | "when"
            | "where"
            | "which"
            | "who"
            | "with"
            | "would"
            | "you"
            | "your"
            | "그리고"
            | "어디"
            | "어떤"
            | "어떻게"
            | "사람"
            | "사람들"
    )
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use crate::{
        domain::{
            Decision, DecisionReason, Document, ResolveQuestionRequest, ScoreBreakdown,
            SearchFilters,
        },
        seed,
    };

    use super::{
        Candidate, IndexedDocument, Resolver, embed, select_candidate_indices, word_terms,
    };

    fn request(question: &str, requested_documents: usize) -> ResolveQuestionRequest {
        ResolveQuestionRequest {
            question: question.to_owned(),
            requested_documents,
            budget_krw: None,
            filters: SearchFilters::default(),
        }
    }

    #[test]
    fn covered_question_returns_payment_safe_hit() {
        let resolver = Resolver::new(seed::documents());
        let result = resolver
            .resolve(request(
                "Where do people living in Seongsu eat lunch when the queue is long?",
                3,
            ))
            .unwrap();

        assert_eq!(result.decision, Decision::Hit);
        assert_eq!(result.reason, DecisionReason::CoverageReady);
        assert_eq!(result.matches.len(), 3);
        assert!(
            result
                .quote
                .as_ref()
                .is_some_and(|quote| quote.total_price_krw > 0)
        );
        assert!(result.open_call.is_none());

        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("convenience store lunchbox"));
        assert!(!json.contains("Yeonmujang-gil"));
    }

    #[test]
    fn uncovered_question_returns_open_call_draft() {
        let resolver = Resolver::new(seed::documents());
        let result = resolver
            .resolve(request(
                "How do deep-sea welders repair an offshore turbine in winter?",
                5,
            ))
            .unwrap();

        assert_eq!(result.decision, Decision::Miss);
        assert_eq!(result.reason, DecisionReason::NoRelevantDocuments);
        assert!(result.matches.is_empty());
        let draft = result
            .open_call
            .expect("a miss should suggest an open call");
        assert_eq!(draft.target_answers, 5);
        assert_eq!(draft.answers_needed, 5);
        assert_eq!(draft.suggested_budget_krw, 2_500);
    }

    #[test]
    fn insufficient_coverage_preserves_existing_quote_and_only_fills_gap() {
        let resolver = Resolver::new(seed::documents());
        let result = resolver
            .resolve(request(
                "What daily routes and dinner habits do long-term Paris residents have?",
                5,
            ))
            .unwrap();

        assert_eq!(result.decision, Decision::Miss);
        assert_eq!(result.reason, DecisionReason::InsufficientCoverage);
        assert!(!result.matches.is_empty());
        let draft = result.open_call.unwrap();
        assert_eq!(draft.answers_needed, 5 - draft.existing_matches);
    }

    #[test]
    fn budget_is_enforced_before_a_hit_is_declared() {
        let resolver = Resolver::new(seed::documents());
        let mut input = request(
            "Where do people living in Seongsu eat lunch when the queue is long?",
            3,
        );
        input.budget_krw = Some(5);
        let result = resolver.resolve(input).unwrap();

        assert_eq!(result.decision, Decision::Miss);
        assert!(
            result
                .quote
                .as_ref()
                .is_none_or(|quote| quote.total_price_krw <= 5)
        );
    }

    #[test]
    fn unknown_category_is_rejected_instead_of_becoming_a_silent_miss() {
        let resolver = Resolver::new(seed::documents());
        let mut input = request("What do Paris residents eat for dinner?", 1);
        input.filters.category = Some("unknown".to_owned());

        assert!(matches!(
            resolver.resolve(input),
            Err(crate::domain::ResolveError::UnsupportedFilter)
        ));
    }

    #[test]
    fn korean_query_can_retrieve_english_paris_evidence() {
        let result = Resolver::new(seed::documents())
            .resolve(request("파리에 사는 사람들은 어떤 음식을 좋아하나요?", 1))
            .unwrap();
        assert_eq!(result.decision, Decision::Hit);
        assert!(result.matches[0].shelf.contains("Paris"));
    }

    #[test]
    fn bundle_selection_does_not_let_one_expensive_result_consume_the_budget() {
        let make = |id: &str, author: &str, price: u64, content: &str| {
            let document = Document {
                id: id.to_owned(),
                handle: id.to_uppercase(),
                author_id: author.to_owned(),
                shelf_id: "test".to_owned(),
                shelf: "Test".to_owned(),
                category: "food".to_owned(),
                content: content.to_owned(),
                tags: vec!["paris".to_owned(), "food".to_owned()],
                price_krw: price,
                age_days: 0,
                quality_score: 0.9,
                reliability_score: 0.9,
                locked: false,
                demographics: None,
            };
            let searchable = super::searchable_text(&document);
            IndexedDocument {
                embedding: embed(&searchable),
                terms: word_terms(&searchable).into_iter().collect(),
                document,
            }
        };
        let indexed = [
            make("expensive", "a", 90, "Paris food market details"),
            make("value-one", "b", 50, "Paris lunch cafe details"),
            make("value-two", "c", 50, "Paris dinner home cooking details"),
        ];
        let candidates = indexed
            .iter()
            .enumerate()
            .map(|(index, indexed)| Candidate {
                indexed,
                score: [0.95, 0.82, 0.81][index],
                breakdown: ScoreBreakdown {
                    relevance: 0.8,
                    term_coverage: 0.8,
                    authority: 0.5,
                    trust: 0.9,
                    freshness: 1.0,
                },
            })
            .collect::<Vec<_>>();
        let selected = select_candidate_indices(&candidates, 2, Some(100));
        assert_eq!(selected.len(), 2);
        assert_eq!(
            selected
                .iter()
                .map(|index| candidates[*index].indexed.document.price_krw)
                .sum::<u64>(),
            100
        );
    }
}
