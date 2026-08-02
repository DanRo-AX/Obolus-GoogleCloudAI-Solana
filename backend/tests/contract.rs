use openshelf_api::{
    domain::{Decision, ResolveQuestionRequest, SearchFilters},
    search::Resolver,
    seed,
};

#[test]
fn matching_is_deterministic_for_the_same_corpus() {
    let resolver = Resolver::new(seed::documents());
    let request = || ResolveQuestionRequest {
        question: "How long will Seongsu residents wait in a weekday lunch queue?".to_owned(),
        requested_documents: 3,
        budget_krw: None,
        filters: SearchFilters::default(),
    };

    let first = resolver.resolve(request()).unwrap();
    let second = resolver.resolve(request()).unwrap();

    assert_eq!(first.decision, Decision::Hit);
    assert_ne!(first.query_id, second.query_id);
    assert_eq!(
        first
            .matches
            .iter()
            .map(|item| item.handle.as_str())
            .collect::<Vec<_>>(),
        second
            .matches
            .iter()
            .map(|item| item.handle.as_str())
            .collect::<Vec<_>>(),
    );
}
