use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::domain::{
    Decision, DecisionReason, Document, MAX_REQUESTED_DOCUMENTS, MatchedDocument, OpenCallDraft,
    Quote, ResolveError, ResolveQuestionRequest, ResolveQuestionResponse, ScoreBreakdown,
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
        }
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
            .filter_map(|indexed| score(indexed, &query_embedding, &query_terms, &anchor_terms))
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

        // Representative results, not repeated passages from one contributor.
        let mut authors = HashSet::new();
        let mut spent = 0_u64;
        let mut budget_blocked = false;
        let mut matches = Vec::new();
        for candidate in candidates {
            if matches.len() == request.requested_documents {
                break;
            }
            let document = &candidate.indexed.document;
            if !authors.insert(document.author_id.as_str()) {
                continue;
            }
            if request
                .budget_krw
                .is_some_and(|budget| spent + document.price_krw > budget)
            {
                budget_blocked = true;
                continue;
            }

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
            decision,
            reason,
            requested_documents: request.requested_documents,
            candidate_count,
            matches,
            quote,
            open_call,
        })
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
        .age_band
        .as_deref()
        .is_some_and(|value| !["under-25", "25-34", "35-44", "45-54", "55-plus"].contains(&value))
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
    let final_score = relevance * 0.72 + term_coverage * 0.13 + trust * 0.10 + freshness * 0.05;
    Some(Candidate {
        indexed,
        score: final_score,
        breakdown: ScoreBreakdown {
            relevance,
            term_coverage,
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
    if !term.is_ascii() || term == "paris" {
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
        domain::{Decision, DecisionReason, ResolveQuestionRequest, SearchFilters},
        seed,
    };

    use super::Resolver;

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
        input.budget_krw = Some(500);
        let result = resolver.resolve(input).unwrap();

        assert_eq!(result.decision, Decision::Miss);
        assert!(
            result
                .quote
                .as_ref()
                .is_none_or(|quote| quote.total_price_krw <= 500)
        );
    }
}
