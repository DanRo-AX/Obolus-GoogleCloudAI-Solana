use crate::domain::PublicEvidenceRecord;

const CURATED_PUBLIC_EVIDENCE: &str = include_str!("../data/public-evidence.json");

/// Versioned, source-bound public facts used to make a new installation useful
/// without fabricating contributors. The facts are short paraphrases of public
/// filings; the canonical filing URL and record identifier remain attached.
pub fn records() -> Vec<PublicEvidenceRecord> {
    serde_json::from_str(CURATED_PUBLIC_EVIDENCE)
        .expect("curated public evidence must remain valid JSON")
}

#[cfg(test)]
mod tests {
    use super::records;

    #[test]
    fn curated_records_are_unique_and_source_bound() {
        let records = records();
        assert!(records.len() >= 6);
        let mut ids = std::collections::HashSet::new();
        for record in records {
            assert!(ids.insert(record.id));
            assert!(record.source_url.starts_with("https://www.sec.gov/"));
            assert!(!record.question.trim().is_empty());
            assert!(!record.answer.trim().is_empty());
            assert!(!record.source_license.trim().is_empty());
        }
    }
}
