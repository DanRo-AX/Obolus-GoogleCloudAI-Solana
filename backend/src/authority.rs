use std::collections::{HashMap, HashSet};

use crate::domain::EvidenceEdge;

const DAMPING: f32 = 0.85;
const ITERATIONS: usize = 40;

/// Computes a query-personalized PageRank vector over the evidence graph.
///
/// The caller supplies the teleport distribution, normally derived from free
/// lexical/semantic retrieval. Only independently meaningful evidence edges
/// pass rank; payments, self-links, raw UGC, disputes, and derived copies are
/// deliberately retained in storage but neutralized here.
pub fn personalized_page_rank(
    node_ids: &[String],
    edges: &[EvidenceEdge],
    teleport_weights: &HashMap<String, f32>,
) -> HashMap<String, f32> {
    if node_ids.is_empty() {
        return HashMap::new();
    }

    let positions = node_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut teleport = node_ids
        .iter()
        .map(|id| {
            teleport_weights
                .get(id)
                .copied()
                .unwrap_or_default()
                .max(0.0)
        })
        .collect::<Vec<_>>();
    normalise_or_uniform(&mut teleport);

    let mut outgoing = vec![Vec::<(usize, f32)>::new(); node_ids.len()];
    let positive_pairs = edges
        .iter()
        .filter(|edge| effective_weight(edge) > 0.0)
        .map(|edge| {
            (
                edge.source_document_id.as_str(),
                edge.target_document_id.as_str(),
            )
        })
        .collect::<HashSet<_>>();
    for edge in edges {
        let Some(&source) = positions.get(edge.source_document_id.as_str()) else {
            continue;
        };
        let Some(&target) = positions.get(edge.target_document_id.as_str()) else {
            continue;
        };
        if source == target {
            continue;
        }
        let reciprocal = positive_pairs.contains(&(
            edge.target_document_id.as_str(),
            edge.source_document_id.as_str(),
        ));
        let weight = effective_weight(edge)
            * if reciprocal && edge.provenance == "organic" {
                0.2
            } else {
                1.0
            };
        if weight > 0.0 {
            outgoing[source].push((target, weight));
        }
    }

    let mut rank = teleport.clone();
    for _ in 0..ITERATIONS {
        let mut next = teleport
            .iter()
            .map(|weight| (1.0 - DAMPING) * weight)
            .collect::<Vec<_>>();
        let mut dangling_mass = 0.0;

        for (source, links) in outgoing.iter().enumerate() {
            let total_weight = links.iter().map(|(_, weight)| *weight).sum::<f32>();
            if total_weight <= f32::EPSILON {
                dangling_mass += rank[source];
                continue;
            }
            for (target, weight) in links {
                next[*target] += DAMPING * rank[source] * (*weight / total_weight);
            }
        }

        for (index, probability) in teleport.iter().enumerate() {
            next[index] += DAMPING * dangling_mass * probability;
        }
        normalise_or_uniform(&mut next);
        rank = next;
    }

    node_ids.iter().cloned().zip(rank).collect()
}

fn effective_weight(edge: &EvidenceEdge) -> f32 {
    let provenance = match edge.provenance.as_str() {
        "organic" => 1.0,
        "admin_verified" => 1.1,
        "outcome_verified" => 1.3,
        // These edges remain useful for audits, usage analytics, and spam
        // detection, but must never let someone buy or self-mint authority.
        "sponsored" | "paid" | "self" | "ugc" | "agent_inferred" => 0.0,
        _ => 0.0,
    };
    let relation = match edge.relation.as_str() {
        "cites" => 0.8,
        "corroborates" => 1.0,
        "endorses" => 0.7,
        "verified_outcome" => 1.2,
        "contextualizes" => 0.35,
        // Negative and lineage edges should affect other classifiers, not
        // propagate positive authority.
        "derived_from"
        | "contradicts"
        | "disputes"
        | "paid_open"
        | "accepted_contribution"
        | "same_owner" => 0.0,
        _ => 0.0,
    };
    edge.weight.clamp(0.0, 2.0) * provenance * relation
}

fn normalise_or_uniform(values: &mut [f32]) {
    let total = values.iter().sum::<f32>();
    if total <= f32::EPSILON {
        let uniform = 1.0 / values.len() as f32;
        values.fill(uniform);
        return;
    }
    for value in values {
        *value /= total;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::domain::EvidenceEdge;

    use super::personalized_page_rank;

    fn edge(source: &str, target: &str, relation: &str, provenance: &str) -> EvidenceEdge {
        EvidenceEdge {
            source_document_id: source.to_owned(),
            target_document_id: target.to_owned(),
            relation: relation.to_owned(),
            provenance: provenance.to_owned(),
            topic: "food".to_owned(),
            weight: 1.0,
        }
    }

    #[test]
    fn independent_corroboration_passes_authority() {
        let nodes = vec![
            "source".to_owned(),
            "supported".to_owned(),
            "other".to_owned(),
        ];
        let teleport = HashMap::from([
            ("source".to_owned(), 0.8),
            ("supported".to_owned(), 0.1),
            ("other".to_owned(), 0.1),
        ]);
        let rank = personalized_page_rank(
            &nodes,
            &[edge("source", "supported", "corroborates", "organic")],
            &teleport,
        );

        assert!(rank["supported"] > rank["other"]);
    }

    #[test]
    fn paid_and_self_edges_cannot_buy_authority() {
        let nodes = vec!["source".to_owned(), "paid".to_owned(), "self".to_owned()];
        let teleport = HashMap::from([
            ("source".to_owned(), 0.8),
            ("paid".to_owned(), 0.1),
            ("self".to_owned(), 0.1),
        ]);
        let rank = personalized_page_rank(
            &nodes,
            &[
                edge("source", "paid", "corroborates", "sponsored"),
                edge("source", "self", "corroborates", "self"),
            ],
            &teleport,
        );

        assert!((rank["paid"] - rank["self"]).abs() < 0.0001);
    }
}
