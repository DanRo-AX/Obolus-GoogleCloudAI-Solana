use std::{
    sync::{Arc, Barrier, mpsc},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use openshelf_api::{
    domain::{
        BindPayShChallengesRequest, ClaimPaymentAttemptRequest, CreateOpenCallRequest,
        CreatePaymentBundleRequest, PayShChallengeBindingRequest, PrepareDirectPayShPaymentRequest,
        RecordChainSettlementRequest, ResolveQuestionRequest, ReviewDisputeRequest, SearchFilters,
        UpsertProfileRequest,
    },
    rollback_audit::RollbackAuditIntent,
    rollback_sweep::{RollbackCoverage, RollbackSweepLedger},
    search::Resolver,
    store::{AiGenerationClaim, PayShDeliveryRequest, PaymentQuotePolicy, Store},
};
use postgres::{Client, NoTls};

use sha2::{Digest, Sha256};

/// Exercises the production database engine with two independent application
/// connections. SQLite's process mutex cannot prove these Cloud Run races.
#[test]
fn postgres_allows_exactly_one_concurrent_payment_claim_per_rail() {
    let database_url = match std::env::var("OPENSHELF_TEST_POSTGRES_URL") {
        Ok(value) => value,
        Err(error) => {
            assert_ne!(
                std::env::var("OPENSHELF_REQUIRE_POSTGRES_CONTRACT").as_deref(),
                Ok("true"),
                "CI requires the PostgreSQL contract URL: {error}"
            );
            return;
        }
    };
    assert!(
        database_url.contains("openshelf_test"),
        "the PostgreSQL contract test requires a dedicated openshelf_test database"
    );

    let setup = Store::open(&database_url).expect("PostgreSQL test store should migrate");

    // Simulate Cloud SQL terminating an idle backend during maintenance. The
    // first query may discover the broken socket, but a later top-level store
    // operation must establish a new session instead of leaving the Cloud Run
    // instance permanently dead. Reconnection is deliberately forbidden
    // inside a transaction because that could commit only its latter half.
    let reconnect_name = format!("openshelf_reconnect_{}", now_ms());
    let reconnect_separator = if database_url.contains('?') { '&' } else { '?' };
    let reconnect_url =
        format!("{database_url}{reconnect_separator}application_name={reconnect_name}");
    let reconnect_store =
        Store::open(&reconnect_url).expect("reconnect test store should establish a session");
    reconnect_store
        .ready()
        .expect("reconnect test session should initially be healthy");
    let mut connection_killer =
        Client::connect(&database_url, NoTls).expect("connection killer should open");
    let terminated_pid = connection_killer
        .query_one(
            "SELECT pid FROM pg_stat_activity
             WHERE application_name = $1 AND pid <> pg_backend_pid()
             ORDER BY backend_start DESC LIMIT 1",
            &[&reconnect_name],
        )
        .expect("the application session should be visible")
        .get::<_, i32>(0);
    assert!(
        connection_killer
            .query_one("SELECT pg_terminate_backend($1)", &[&terminated_pid])
            .expect("backend termination should run")
            .get::<_, bool>(0),
        "the database must terminate the selected application session"
    );
    let mut recovered = false;
    for _ in 0..50 {
        if reconnect_store.ready().is_ok() {
            recovered = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        recovered,
        "a store operation after forced PostgreSQL disconnect must reconnect"
    );
    let replacement_pid = connection_killer
        .query_one(
            "SELECT pid FROM pg_stat_activity
             WHERE application_name = $1 AND pid <> pg_backend_pid()
             ORDER BY backend_start DESC LIMIT 1",
            &[&reconnect_name],
        )
        .expect("the replacement application session should be visible")
        .get::<_, i32>(0);
    assert_ne!(replacement_pid, terminated_pid);
    drop(reconnect_store);

    let cold_start_barrier = Arc::new(Barrier::new(4));
    let cold_start_workers = (0..4)
        .map(|_| {
            let database_url = database_url.clone();
            let barrier = Arc::clone(&cold_start_barrier);
            std::thread::spawn(move || {
                barrier.wait();
                Store::open(database_url)
            })
        })
        .collect::<Vec<_>>();
    let cold_start_stores = cold_start_workers
        .into_iter()
        .map(|worker| {
            worker
                .join()
                .expect("PostgreSQL cold-start worker should not panic")
        })
        .collect::<Result<Vec<_>, _>>()
        .expect("concurrent PostgreSQL schema migration should serialize");
    assert!(cold_start_stores.iter().all(|store| store.ready().is_ok()));
    drop(cold_start_stores);

    // A query capability can be replayed against many Cloud Run instances at
    // once. The production engine must elect exactly one paid model caller,
    // and a process death after that election must remain fenced on restart.
    let ai_scope = format!("postgres-ai-provider-race-{}", now_ms());
    let ai_input_hash = hex_digest("same canonical paid evidence");
    let ai_handles = vec!["SEONGS_11".to_owned()];
    let ai_barrier = Arc::new(Barrier::new(6));
    let ai_workers = (0..6)
        .map(|_| {
            let store = Store::open(&database_url).expect("AI race connection should open");
            let barrier = Arc::clone(&ai_barrier);
            let scope = ai_scope.clone();
            let input_hash = ai_input_hash.clone();
            let handles = ai_handles.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.claim_ai_generation("synthesis", &scope, &input_hash, &handles)
            })
        })
        .collect::<Vec<_>>();
    let ai_claims = ai_workers
        .into_iter()
        .map(|worker| {
            worker
                .join()
                .expect("AI race worker should not panic")
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ai_claims
            .iter()
            .filter(|claim| matches!(claim, AiGenerationClaim::Acquired { .. }))
            .count(),
        1,
        "PostgreSQL must hand the exact provider request to one process"
    );
    assert_eq!(
        Store::open(&database_url)
            .expect("AI crash-recovery connection should open")
            .claim_ai_generation("synthesis", &ai_scope, &ai_input_hash, &ai_handles)
            .unwrap(),
        AiGenerationClaim::Suppressed,
        "an ambiguous provider call must survive process loss without automatic repurchase"
    );
    connection_killer
        .execute(
            "DELETE FROM ai_generation_documents WHERE scope_id = $1",
            &[&ai_scope],
        )
        .expect("AI document fixture should be cleaned up");
    connection_killer
        .execute(
            "DELETE FROM ai_generation_attempts WHERE scope_id = $1",
            &[&ai_scope],
        )
        .expect("AI attempt fixture should be cleaned up");
    connection_killer
        .execute(
            "DELETE FROM ai_generation_budgets WHERE scope_id = $1",
            &[&ai_scope],
        )
        .expect("AI budget fixture should be cleaned up");

    let question = "Which Seongsu lunch queue is tolerable during a real weekday break?";
    let resolved = Resolver::new(setup.documents().expect("seed documents should load"))
        .resolve(ResolveQuestionRequest {
            question: question.to_owned(),
            requested_documents: 1,
            budget_krw: None,
            filters: SearchFilters::default(),
        })
        .expect("seed question should resolve");
    let payment_token_hash = "9".repeat(64);
    setup
        .record_resolution(question, &resolved, Some(&payment_token_hash))
        .expect("resolution should persist");
    let policy = PaymentQuotePolicy {
        fallback_recipient: Some(bs58::encode([71_u8; 32]).into_string()),
        bundle_recipient: Some(bs58::encode([72_u8; 32]).into_string()),
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".to_owned(),
        asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
        krw_per_usdc: 1_350,
        ttl_ms: 300_000,
    };
    let quote = setup
        .x402_payment_quote(&resolved.query_id, &resolved.matches[0].handle, &policy)
        .expect("document quote should be created");
    drop(setup);

    let first_store = Store::open(&database_url).expect("first worker connection should open");
    let second_store = Store::open(&database_url).expect("second worker connection should open");
    let barrier = Arc::new(Barrier::new(2));
    let quote_id = quote.id.clone();

    let workers = [
        (
            first_store,
            BASE64_STANDARD.encode(prepared_x402_transaction(61)),
            Arc::clone(&barrier),
        ),
        (
            second_store,
            BASE64_STANDARD.encode(prepared_x402_transaction(62)),
            barrier,
        ),
    ]
    .map(|(store, signed_transaction, barrier)| {
        let quote_id = quote_id.clone();
        std::thread::spawn(move || {
            barrier.wait();
            let request = ClaimPaymentAttemptRequest {
                settlement_kind: "document".to_owned(),
                quote_id,
                attempt_id: hex_digest(&signed_transaction),
                payer: Some(bs58::encode([63_u8; 32]).into_string()),
                signed_transaction_base64: Some(signed_transaction),
                recent_blockhash: Some(bs58::encode([64_u8; 32]).into_string()),
                absence_observed: false,
            };
            let outcome = store.claim_payment_attempt(&request);
            (request, outcome)
        })
    });

    let outcomes = workers.map(|worker| worker.join().expect("claim worker should not panic"));
    let successes = outcomes
        .iter()
        .filter(|(_, outcome)| outcome.is_ok())
        .count();
    assert_eq!(
        successes, 1,
        "exactly one database connection must own the quote"
    );
    assert!(
        outcomes.iter().any(|(_, outcome)| outcome.is_err()),
        "the losing connection must fail closed"
    );

    let (winner, _) = outcomes
        .into_iter()
        .find(|(_, outcome)| outcome.is_ok())
        .expect("one winner should exist");
    let cleanup = Store::open(&database_url).expect("cleanup connection should open");
    assert!(
        cleanup
            .release_payment_attempt(&winner)
            .expect("winner fence should release")
            .released
    );

    // The DB commit can succeed while the API process dies before its external
    // rollback-audit write. Two replacement instances retrying the exact same
    // signed transaction must converge on one PostgreSQL row so either can
    // finish that audit step; a 409 here would strand payment indefinitely.
    let retry_signed = BASE64_STANDARD.encode(prepared_x402_transaction(74));
    let retry_request = ClaimPaymentAttemptRequest {
        settlement_kind: "document".to_owned(),
        quote_id: quote.id.clone(),
        attempt_id: Sha256::digest(retry_signed.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        payer: Some(bs58::encode([73_u8; 32]).into_string()),
        signed_transaction_base64: Some(retry_signed),
        recent_blockhash: Some(quote.pay_to.clone()),
        absence_observed: false,
    };
    let exact_retry_barrier = Arc::new(Barrier::new(2));
    let exact_retry_workers = [0, 1].map(|_| {
        let store = Store::open(&database_url).expect("exact retry connection should open");
        let request = retry_request.clone();
        let barrier = Arc::clone(&exact_retry_barrier);
        std::thread::spawn(move || {
            barrier.wait();
            store.claim_payment_attempt(&request)
        })
    });
    let exact_retry_outcomes = exact_retry_workers.map(|worker| {
        worker
            .join()
            .expect("exact retry worker should not panic")
            .expect("both exact retries should recover the same fence")
    });
    assert_eq!(exact_retry_outcomes[0], exact_retry_outcomes[1]);
    let retry_intent = RollbackAuditIntent::chain(
        &cleanup
            .payment_attempt_reconciliation(&retry_request.attempt_id)
            .expect("exact retry should expose its immutable economics"),
    )
    .expect("signed retry should form a complete rollback intent");
    assert_eq!(
        RollbackSweepLedger::connect_postgres(&database_url)
            .expect("sweep should open a separate PostgreSQL read path")
            .inspect(&retry_intent)
            .expect("sweep should query the production schema"),
        RollbackCoverage::Covered("attempt")
    );
    assert!(
        cleanup
            .release_payment_attempt(&retry_request)
            .expect("exact retry fence should release before later races")
            .released
    );

    // Race the two aggregate funding contracts on real PostgreSQL connections.
    // The agent has no prepaid session and the browser does; a process-local or
    // SQLite-only test cannot prove the query-row lock excludes the other rail.
    let bundle_race_question = format!(
        "Which two real Seongsu lunch accounts survive a browser-agent race {}?",
        now_ms()
    );
    let bundle_race_resolution =
        Resolver::new(cleanup.documents().expect("bundle documents should load"))
            .resolve(ResolveQuestionRequest {
                question: bundle_race_question.clone(),
                requested_documents: 3,
                budget_krw: None,
                filters: SearchFilters::default(),
            })
            .expect("bundle race question should resolve");
    let bundle_handles = bundle_race_resolution
        .matches
        .iter()
        .take(2)
        .map(|matched| matched.handle.clone())
        .collect::<Vec<_>>();
    assert_eq!(bundle_handles.len(), 2);
    let bundle_token_hash = "4".repeat(64);
    cleanup
        .record_resolution(
            &bundle_race_question,
            &bundle_race_resolution,
            Some(&bundle_token_hash),
        )
        .expect("bundle race resolution should persist");
    let wallet_seed = Sha256::digest(bundle_race_resolution.query_id.as_bytes());
    let browser_wallet = bs58::encode(wallet_seed).into_string();
    let browser_user = cleanup
        .register_user(
            &format!("{}@test.invalid", bundle_race_resolution.query_id),
            "postgres-bundle-race-password-hash",
        )
        .expect("bundle race browser user should persist");
    cleanup
        .bind_wallet_identity(&browser_user.id, &browser_wallet)
        .expect("bundle race wallet identity should bind");
    let session_token = Sha256::digest(bundle_race_question.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    cleanup
        .issue_prepaid_wallet_session(
            &browser_user.id,
            &browser_wallet,
            &session_token,
            300_000,
            &policy,
        )
        .expect("bundle race prepaid session should persist");
    let session_hash = Sha256::digest(session_token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let create_agent = CreatePaymentBundleRequest {
        query_id: bundle_race_resolution.query_id.clone(),
        handles: bundle_handles.clone(),
        top_up_atomic: None,
        expected_invoice_hash: None,
    };
    let create_browser = CreatePaymentBundleRequest {
        top_up_atomic: Some("5000000".to_owned()),
        ..create_agent.clone()
    };
    let bundle_barrier = Arc::new(Barrier::new(2));
    let agent_store = Store::open(&database_url).expect("agent bundle connection should open");
    let agent_barrier = Arc::clone(&bundle_barrier);
    let agent_token_hash = bundle_token_hash.clone();
    let agent_policy = policy.clone();
    let agent_worker = std::thread::spawn(move || {
        agent_barrier.wait();
        agent_store.create_agent_payment_bundle(&create_agent, &agent_token_hash, &agent_policy)
    });
    let browser_store = Store::open(&database_url).expect("browser bundle connection should open");
    let browser_token_hash = bundle_token_hash.clone();
    let browser_policy = policy.clone();
    let browser_worker = std::thread::spawn(move || {
        bundle_barrier.wait();
        browser_store.create_payment_bundle(
            &create_browser,
            &browser_token_hash,
            &session_hash,
            &browser_policy,
        )
    });
    let bundle_outcomes = [
        agent_worker
            .join()
            .expect("agent bundle worker should not panic"),
        browser_worker
            .join()
            .expect("browser bundle worker should not panic"),
    ];
    assert_eq!(
        bundle_outcomes
            .iter()
            .filter(|outcome| outcome.is_ok())
            .count(),
        1,
        "one PostgreSQL query-row lock must admit exactly one aggregate funding contract"
    );
    assert_eq!(
        bundle_outcomes
            .iter()
            .filter(|outcome| outcome.is_err())
            .count(),
        1,
        "the losing aggregate rail must fail closed"
    );
    let mut bundle_database =
        Client::connect(&database_url, NoTls).expect("bundle race inspection should open");
    let bundle_count = bundle_database
        .query_one(
            "SELECT COUNT(*), COUNT(DISTINCT funding_source)
             FROM payment_bundle_quotes WHERE query_id = $1",
            &[&bundle_race_resolution.query_id],
        )
        .expect("bundle race state should load");
    assert_eq!(bundle_count.get::<_, i64>(0), 1);
    assert_eq!(bundle_count.get::<_, i64>(1), 1);

    // Race the outer aggregate product against a copied direct Pay.sh URL for
    // the same document. The winner may depend on scheduling, but the loser
    // must fail before either product can expose a second fund movement.
    let product_race_question = format!(
        "Can direct and aggregate funding collide for one real Seongsu lunch purchase {}?",
        now_ms()
    );
    let product_race_resolution = Resolver::new(
        cleanup
            .documents()
            .expect("product race documents should load"),
    )
    .resolve(ResolveQuestionRequest {
        question: product_race_question.clone(),
        requested_documents: 1,
        budget_krw: None,
        filters: SearchFilters::default(),
    })
    .expect("product race question should resolve");
    let product_race_token = "3".repeat(64);
    cleanup
        .record_resolution(
            &product_race_question,
            &product_race_resolution,
            Some(&product_race_token),
        )
        .expect("product race resolution should persist");
    let product_query_id = product_race_resolution.query_id.clone();
    let product_handle = product_race_resolution.matches[0].handle.clone();
    let product_barrier = Arc::new(Barrier::new(2));
    let product_direct_store =
        Store::open(&database_url).expect("product direct connection should open");
    let product_direct_barrier = Arc::clone(&product_barrier);
    let product_direct_query = product_query_id.clone();
    let product_direct_handle = product_handle.clone();
    let product_direct_token = product_race_token.clone();
    let product_direct_policy = policy.clone();
    let product_direct = std::thread::spawn(move || {
        product_direct_barrier.wait();
        product_direct_store
            .pay_sh_resource(
                &product_direct_query,
                &product_direct_handle,
                &product_direct_token,
                &product_direct_policy,
            )
            .map(|resource| resource.quote_id)
    });
    let product_bundle_store =
        Store::open(&database_url).expect("product bundle connection should open");
    let product_bundle_query = product_query_id.clone();
    let product_bundle_handle = product_handle.clone();
    let product_bundle_token = product_race_token.clone();
    let product_bundle_policy = policy.clone();
    let product_bundle = std::thread::spawn(move || {
        product_barrier.wait();
        product_bundle_store
            .create_agent_payment_bundle(
                &CreatePaymentBundleRequest {
                    query_id: product_bundle_query,
                    handles: vec![product_bundle_handle],
                    top_up_atomic: None,
                    expected_invoice_hash: None,
                },
                &product_bundle_token,
                &product_bundle_policy,
            )
            .map(|quote| quote.id)
    });
    let product_outcomes = [
        product_direct
            .join()
            .expect("product direct worker should not panic"),
        product_bundle
            .join()
            .expect("product bundle worker should not panic"),
    ];
    assert_eq!(
        product_outcomes
            .iter()
            .filter(|outcome| outcome.is_ok())
            .count(),
        1,
        "one query-row lock must admit only one buyer funding product"
    );
    let product_counts = bundle_database
        .query_one(
            "SELECT
                (SELECT COUNT(*) FROM payment_quotes
                 WHERE query_id = $1 AND document_handle = $2),
                (SELECT COUNT(*) FROM payment_bundle_quotes pbq
                 JOIN payment_bundle_documents pbd ON pbd.quote_id = pbq.id
                 WHERE pbq.query_id = $1 AND pbd.document_handle = $2)",
            &[&product_query_id, &product_handle],
        )
        .expect("product race state should load");
    assert_eq!(
        product_counts.get::<_, i64>(0) + product_counts.get::<_, i64>(1),
        1,
        "the losing product must not leave a payable row behind"
    );

    // Exercise the rolling-deployment write shapes directly on PostgreSQL.
    // The research job owns this document, so an old direct writer must lose
    // even when both INSERTs reach separate database sessions simultaneously.
    let attempt_race_question = format!(
        "Can old direct and research writers charge one Seongsu lunch quote {}?",
        now_ms()
    );
    let attempt_race_resolution = Resolver::new(
        cleanup
            .documents()
            .expect("attempt race documents should load"),
    )
    .resolve(ResolveQuestionRequest {
        question: attempt_race_question.clone(),
        requested_documents: 1,
        budget_krw: None,
        filters: SearchFilters::default(),
    })
    .expect("attempt race question should resolve");
    let attempt_race_token = "2".repeat(64);
    cleanup
        .record_resolution(
            &attempt_race_question,
            &attempt_race_resolution,
            Some(&attempt_race_token),
        )
        .expect("attempt race resolution should persist");
    let attempt_race_bundle = cleanup
        .create_agent_payment_bundle(
            &CreatePaymentBundleRequest {
                query_id: attempt_race_resolution.query_id.clone(),
                handles: vec![attempt_race_resolution.matches[0].handle.clone()],
                top_up_atomic: None,
                expected_invoice_hash: None,
            },
            &attempt_race_token,
            &policy,
        )
        .expect("attempt race bundle should persist");
    let rolling_bundle_id = format!("rolling-overlap-{}", attempt_race_bundle.id);
    let mut rolling_bundle_client =
        Client::connect(&database_url, NoTls).expect("rolling bundle writer should connect");
    let mut rolling_bundle_transaction = rolling_bundle_client
        .transaction()
        .expect("rolling bundle transaction should begin");
    rolling_bundle_transaction
        .execute(
            "INSERT INTO payment_bundle_quotes
             (id, query_id, pay_to, network, asset, amount_atomic, total_price_krw,
              krw_per_usdc, expires_at, created_at, bundle_hash, status, funding_source)
             SELECT $1, query_id, pay_to, network, asset, amount_atomic, total_price_krw,
                    krw_per_usdc, expires_at, created_at, $2, 'quoted', 'legacy_direct'
             FROM payment_bundle_quotes WHERE id = $3",
            &[
                &rolling_bundle_id,
                &"postgres-rolling-overlap",
                &attempt_race_bundle.id,
            ],
        )
        .expect("rolling bundle parent shape should insert before its documents");
    assert!(
        rolling_bundle_transaction
            .execute(
                "INSERT INTO payment_bundle_documents
                 (quote_id, rank, document_id, document_handle, author_id,
                  recipient_wallet, price_krw, shelf_snapshot, content_snapshot,
                  content_hash, document_version, consent_version)
                 SELECT $1, rank, document_id, document_handle, author_id,
                        recipient_wallet, price_krw, shelf_snapshot, content_snapshot,
                        content_hash, document_version, consent_version
                 FROM payment_bundle_documents WHERE quote_id = $2",
                &[&rolling_bundle_id, &attempt_race_bundle.id],
            )
            .is_err(),
        "the PostgreSQL document trigger must reject a rolling overlapping bundle"
    );
    rolling_bundle_transaction
        .rollback()
        .expect("the rejected rolling bundle transaction should roll back");
    assert_eq!(
        bundle_database
            .query_one(
                "SELECT COUNT(*) FROM payment_bundle_quotes WHERE id = $1",
                &[&rolling_bundle_id],
            )
            .expect("rolling bundle rollback should be observable")
            .get::<_, i64>(0),
        0
    );
    let signature_seed = Sha256::digest(attempt_race_bundle.id.as_bytes());
    let mut signature_bytes = [0_u8; 64];
    signature_bytes[..32].copy_from_slice(&signature_seed);
    signature_bytes[32..].copy_from_slice(&signature_seed);
    let funding_transaction = BASE64_STANDARD.encode(prepared_x402_transaction(84));
    let funding_payer = bs58::encode([83_u8; 32]).into_string();
    let attempt_race_funding = ClaimPaymentAttemptRequest {
        settlement_kind: "bundle".to_owned(),
        quote_id: attempt_race_bundle.id.clone(),
        attempt_id: Sha256::digest(funding_transaction.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        payer: Some(funding_payer.clone()),
        signed_transaction_base64: Some(funding_transaction),
        recent_blockhash: Some(attempt_race_bundle.pay_to.clone()),
        absence_observed: false,
    };
    cleanup
        .claim_payment_attempt(&attempt_race_funding)
        .expect("attempt race aggregate funding should fence");
    cleanup
        .record_bundle_chain_settlement(&RecordChainSettlementRequest {
            quote_id: attempt_race_bundle.id.clone(),
            attempt_id: Some(attempt_race_funding.attempt_id),
            transaction_signature: bs58::encode(signature_bytes).into_string(),
            payer: funding_payer,
            pay_to: attempt_race_bundle.pay_to.clone(),
            amount_atomic: attempt_race_bundle.amount_atomic.clone(),
            network: attempt_race_bundle.network.clone(),
            raw_response: serde_json::json!({ "success": true }),
        })
        .expect("attempt race aggregate funding should settle");
    let attempt_race_plan = cleanup
        .research_job_plan(&attempt_race_bundle.id, &policy)
        .expect("attempt race research plan should exist");
    let attempt_race_resource = attempt_race_plan.resources[0].clone();
    let research_attempt_id =
        Sha256::digest(format!("{}:research", attempt_race_resource.quote_id))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
    let direct_attempt_id = Sha256::digest(format!("{}:direct", attempt_race_resource.quote_id))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let raw_attempt_barrier = Arc::new(Barrier::new(2));
    let research_database_url = database_url.clone();
    let research_barrier = Arc::clone(&raw_attempt_barrier);
    let research_job_id = attempt_race_bundle.id.clone();
    let research_quote_id = attempt_race_resource.quote_id.clone();
    let research_attempt = research_attempt_id.clone();
    let raw_research_writer = std::thread::spawn(move || {
        let mut client = Client::connect(&research_database_url, NoTls)
            .expect("raw research writer should connect");
        research_barrier.wait();
        client
            .execute(
                "INSERT INTO research_payment_attempts
                 (attempt_id, job_id, quote_id, status, reconcile_after, created_at)
                 VALUES ($1, $2, $3, 'claimed', $4, $4)",
                &[
                    &research_attempt,
                    &research_job_id,
                    &research_quote_id,
                    &(now_ms() as i64),
                ],
            )
            .is_ok()
    });
    let direct_database_url = database_url.clone();
    let direct_quote_id = attempt_race_resource.quote_id.clone();
    let direct_attempt = direct_attempt_id.clone();
    let direct_token = attempt_race_token.clone();
    let direct_wallet = attempt_race_resource.recipient_wallet.clone();
    let raw_direct_writer = std::thread::spawn(move || {
        let mut client =
            Client::connect(&direct_database_url, NoTls).expect("raw direct writer should connect");
        raw_attempt_barrier.wait();
        let now = now_ms() as i64;
        client
            .execute(
                "INSERT INTO direct_pay_sh_attempts
                 (attempt_id, quote_id, query_token_hash, status, challenge_id, external_id,
                  payer_wallet, platform_recipient_wallet, signed_transaction_base64,
                  recent_blockhash, challenge_expires_at, reconcile_after, created_at,
                  prepared_at)
                 VALUES ($1, $2, $3, 'prepared', 'rolling-direct',
                         'human-document-krw-700#rolling', $4, $4, $5, $4,
                         $6, $6, $7, $7)",
                &[
                    &direct_attempt,
                    &direct_quote_id,
                    &direct_token,
                    &direct_wallet,
                    &BASE64_STANDARD.encode([0_u8; 192]),
                    &(now + 60_000),
                    &now,
                ],
            )
            .is_ok()
    });
    let raw_research_won = raw_research_writer
        .join()
        .expect("raw research writer should not panic");
    let raw_direct_won = raw_direct_writer
        .join()
        .expect("raw direct writer should not panic");
    assert!(
        raw_research_won,
        "the bundle-owned research attempt must win"
    );
    assert!(
        !raw_direct_won,
        "a rolling direct writer must fail before external collection"
    );
    let attempt_fence = bundle_database
        .query_one(
            "SELECT attempt_kind, attempt_id FROM pay_sh_quote_fences WHERE quote_id = $1",
            &[&attempt_race_resource.quote_id],
        )
        .expect("the winning attempt fence should exist");
    assert_eq!(attempt_fence.get::<_, String>(0), "research");
    assert_eq!(attempt_fence.get::<_, String>(1), research_attempt_id);
    assert!(
        bundle_database
            .execute(
                "UPDATE research_payment_attempts
                 SET status = 'prepared', signed_transaction_base64 = 'partial'
                 WHERE attempt_id = $1",
                &[&research_attempt_id],
            )
            .is_err(),
        "PostgreSQL must stop an old worker before incomplete evidence reaches paid transport"
    );
    bundle_database
        .execute(
            "UPDATE research_payment_attempts SET status = 'released', completed_at = $2
             WHERE attempt_id = $1",
            &[&research_attempt_id, &(now_ms() as i64)],
        )
        .expect("raw research attempt should terminalize for test cleanup");
    bundle_database
        .execute(
            "DELETE FROM research_payment_attempts WHERE attempt_id = $1",
            &[&research_attempt_id],
        )
        .expect("terminal raw research attempt should clean up");

    // Race the two payment products themselves, not only two claims inside
    // one product. This reproduces two browser/agent clients selecting x402
    // and Pay.sh for the same search result at the same instant.
    let cross_rail_question =
        "Which Seongsu side street remains quiet when two payment clients race?";
    let cross_rail_resolution = Resolver::new(cleanup.documents().expect("documents should load"))
        .resolve(ResolveQuestionRequest {
            question: cross_rail_question.to_owned(),
            requested_documents: 1,
            budget_krw: None,
            filters: SearchFilters::default(),
        })
        .expect("cross-rail question should resolve");
    let cross_rail_token_hash = "7".repeat(64);
    cleanup
        .record_resolution(
            cross_rail_question,
            &cross_rail_resolution,
            Some(&cross_rail_token_hash),
        )
        .expect("cross-rail resolution should persist");
    let cross_rail_query_id = cross_rail_resolution.query_id.clone();
    let cross_rail_handle = cross_rail_resolution.matches[0].handle.clone();
    let cross_rail_barrier = Arc::new(Barrier::new(2));
    let x402_store = Store::open(&database_url).expect("x402 rail connection should open");
    let x402_barrier = Arc::clone(&cross_rail_barrier);
    let x402_query_id = cross_rail_query_id.clone();
    let x402_handle = cross_rail_handle.clone();
    let x402_policy = policy.clone();
    let x402_worker = std::thread::spawn(move || {
        x402_barrier.wait();
        x402_store
            .x402_payment_quote(&x402_query_id, &x402_handle, &x402_policy)
            .map(|quote| quote.id)
    });
    let pay_sh_store = Store::open(&database_url).expect("Pay.sh rail connection should open");
    let pay_sh_query_id = cross_rail_query_id.clone();
    let pay_sh_handle = cross_rail_handle.clone();
    let pay_sh_policy = policy.clone();
    let pay_sh_worker = std::thread::spawn(move || {
        cross_rail_barrier.wait();
        pay_sh_store
            .pay_sh_resource(
                &pay_sh_query_id,
                &pay_sh_handle,
                &cross_rail_token_hash,
                &pay_sh_policy,
            )
            .map(|resource| resource.quote_id)
    });
    let rail_outcomes = [
        x402_worker
            .join()
            .expect("x402 rail worker should not panic"),
        pay_sh_worker
            .join()
            .expect("Pay.sh rail worker should not panic"),
    ];
    assert_eq!(
        rail_outcomes
            .iter()
            .filter(|outcome| outcome.is_ok())
            .count(),
        1,
        "exactly one payment rail may reserve a query/document purchase"
    );
    let reserved_quote_id = rail_outcomes
        .into_iter()
        .find_map(Result::ok)
        .expect("one rail should own the purchase");
    let mut cross_rail_database =
        Client::connect(&database_url, NoTls).expect("cross-rail inspection should open");
    let rail_counts = cross_rail_database
        .query_one(
            "SELECT COUNT(*), COUNT(DISTINCT payment_rail),
                    COUNT(*) FILTER (WHERE payment_rail IS NOT NULL)
             FROM payment_quotes
             WHERE query_id = $1 AND document_handle = $2",
            &[&cross_rail_query_id, &cross_rail_handle],
        )
        .expect("cross-rail reservation should load");
    assert_eq!(
        rail_counts.get::<_, i64>(0),
        1,
        "the race must reuse one quote"
    );
    assert_eq!(
        rail_counts.get::<_, i64>(1),
        1,
        "the purchase must have one rail identity"
    );
    assert_eq!(
        rail_counts.get::<_, i64>(2),
        1,
        "the shared quote must remain durably reserved"
    );
    assert_eq!(
        cross_rail_database
            .query_one(
                "SELECT COUNT(*) FROM payment_quotes WHERE id = $1",
                &[&reserved_quote_id],
            )
            .expect("winning quote should exist")
            .get::<_, i64>(0),
        1
    );

    // A rolling deployment can still have an old process that writes the
    // ledger tables directly without calling bind_document_payment_rail. Race
    // those old write shapes and prove the PostgreSQL triggers serialize them.
    let rolling_question =
        "Can an old Pay.sh writer and a new x402 writer both win one Seongsu lunch row lock?";
    let rolling_resolution = Resolver::new(cleanup.documents().expect("documents should load"))
        .resolve(ResolveQuestionRequest {
            question: rolling_question.to_owned(),
            requested_documents: 1,
            budget_krw: None,
            filters: SearchFilters::default(),
        })
        .expect("rolling-version question should resolve");
    cleanup
        .record_resolution(rolling_question, &rolling_resolution, Some(&"6".repeat(64)))
        .expect("rolling-version resolution should persist");
    let rolling_handle = rolling_resolution.matches[0].handle.clone();
    let rolling_quote = cleanup
        .payment_quote(&rolling_resolution.query_id, &rolling_handle, &policy)
        .expect("unbound rolling-version quote should exist");
    let rolling_barrier = Arc::new(Barrier::new(2));
    let x402_database_url = database_url.clone();
    let x402_quote_id = rolling_quote.id.clone();
    let x402_rolling_barrier = Arc::clone(&rolling_barrier);
    let old_x402_writer = std::thread::spawn(move || {
        let mut client = Client::connect(&x402_database_url, NoTls)
            .expect("old x402 writer connection should open");
        x402_rolling_barrier.wait();
        client
            .execute(
                "INSERT INTO chain_payment_attempts
                 (settlement_kind, quote_id, attempt_id, reconcile_after, created_at)
                 VALUES ('document', $1, $2, 0, 0)",
                &[&x402_quote_id, &"5".repeat(64)],
            )
            .is_ok()
    });
    let pay_sh_database_url = database_url.clone();
    let pay_sh_quote_id = rolling_quote.id.clone();
    let pay_sh_query_id = rolling_quote.query_id.clone();
    let pay_sh_handles =
        serde_json::to_string(&vec![rolling_handle.clone()]).expect("one handle should serialize");
    let pay_sh_price = rolling_quote.price_krw as i64;
    let old_pay_sh_writer = std::thread::spawn(move || {
        let mut client = Client::connect(&pay_sh_database_url, NoTls)
            .expect("old Pay.sh writer connection should open");
        rolling_barrier.wait();
        client
            .execute(
                "INSERT INTO settlements
                 (id, query_id, payer, document_handles_json, total_krw, mode,
                  transaction_signature, created_at)
                 VALUES ($1, $2, 'pay.sh', $3, $4, 'pay_sh_mpp_direct', $5, 0)",
                &[
                    &format!("rolling-pay-sh-{}", pay_sh_quote_id),
                    &pay_sh_query_id,
                    &pay_sh_handles,
                    &pay_sh_price,
                    &format!("pay.sh:{}", pay_sh_quote_id),
                ],
            )
            .is_ok()
    });
    let old_writer_outcomes = [
        old_x402_writer
            .join()
            .expect("old x402 writer should not panic"),
        old_pay_sh_writer
            .join()
            .expect("old Pay.sh writer should not panic"),
    ];
    assert_eq!(
        old_writer_outcomes.into_iter().filter(|won| *won).count(),
        1,
        "database triggers must let only one rolling-version rail write commit"
    );
    let rolling_state = cross_rail_database
        .query_one(
            "SELECT payment_rail,
                    (SELECT COUNT(*) FROM chain_payment_attempts WHERE quote_id = $1),
                    (SELECT COUNT(*) FROM settlements
                     WHERE mode = 'pay_sh_mpp_direct'
                       AND transaction_signature = 'pay.sh:' || $1)
             FROM payment_quotes WHERE id = $1",
            &[&rolling_quote.id],
        )
        .expect("rolling-version state should load");
    let rolling_rail = rolling_state.get::<_, String>(0);
    let rolling_x402_count = rolling_state.get::<_, i64>(1);
    let rolling_pay_sh_count = rolling_state.get::<_, i64>(2);
    assert_eq!(rolling_x402_count + rolling_pay_sh_count, 1);
    assert_eq!(rolling_rail == "x402", rolling_x402_count == 1);
    assert_eq!(rolling_rail == "pay_sh", rolling_pay_sh_count == 1);

    // Repeat the race at the public MPP boundary. These are two genuinely
    // different payer-signed transactions for one copied Pay.sh URL; exactly
    // one may be forwarded to the external collector.
    let direct_question = "Where do locals avoid the lunch rush near Seoul Forest station?";
    let direct_resolution = Resolver::new(cleanup.documents().expect("documents should load"))
        .resolve(ResolveQuestionRequest {
            question: direct_question.to_owned(),
            requested_documents: 1,
            budget_krw: None,
            filters: SearchFilters::default(),
        })
        .expect("direct-payment question should resolve");
    let direct_token_hash = "8".repeat(64);
    cleanup
        .record_resolution(
            direct_question,
            &direct_resolution,
            Some(&direct_token_hash),
        )
        .expect("direct resolution should persist");
    let resource = cleanup
        .pay_sh_resource(
            &direct_resolution.query_id,
            &direct_resolution.matches[0].handle,
            &direct_token_hash,
            &policy,
        )
        .expect("Pay.sh quote should be created");
    drop(cleanup);

    let direct_barrier = Arc::new(Barrier::new(2));
    let direct_workers = [7_u8, 8_u8].map(|signature_byte| {
        let store = Store::open(&database_url).expect("direct worker connection should open");
        let barrier = Arc::clone(&direct_barrier);
        let resource = resource.clone();
        let direct_token_hash = direct_token_hash.clone();
        std::thread::spawn(move || {
            let mut transaction = vec![0_u8; 192];
            transaction[0] = 2;
            transaction[65..129].fill(signature_byte);
            let attempt_id = Sha256::digest(&transaction)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let request = PrepareDirectPayShPaymentRequest {
                quote_id: resource.quote_id.clone(),
                query_id: resource.query_id.clone(),
                document_handle: resource.document_handle.clone(),
                path_price_krw: resource.price_krw,
                owner_wallet: resource.recipient_wallet.clone(),
                payer: resource.recipient_wallet.clone(),
                platform_recipient_wallet: resource.recipient_wallet.clone(),
                challenge_id: format!("postgres-race-{signature_byte}"),
                external_id: format!("human-document-krw-{}#race", resource.price_krw),
                signed_transaction_base64: BASE64_STANDARD.encode(transaction),
                recent_blockhash: resource.recipient_wallet.clone(),
                challenge_expires_at: now_ms() + 60_000,
            };
            store
                .bind_pay_sh_challenges(
                    &BindPayShChallengesRequest {
                        quote_id: resource.quote_id.clone(),
                        query_id: resource.query_id.clone(),
                        document_handle: resource.document_handle.clone(),
                        path_price_krw: resource.price_krw,
                        owner_wallet: resource.recipient_wallet.clone(),
                        research_job_id: None,
                        payment_attempt_id: None,
                        challenges: vec![PayShChallengeBindingRequest {
                            challenge_id: request.challenge_id.clone(),
                            external_id: request.external_id.clone(),
                            challenge_expires_at: request.challenge_expires_at,
                        }],
                    },
                    Some(&direct_token_hash),
                )
                .expect("issued Pay.sh challenge should become durable");
            barrier.wait();
            let outcome =
                store.prepare_direct_pay_sh_payment(&attempt_id, &request, &direct_token_hash);
            (attempt_id, outcome)
        })
    });
    let direct_outcomes =
        direct_workers.map(|worker| worker.join().expect("direct worker should not panic"));
    assert_eq!(
        direct_outcomes
            .iter()
            .filter(|(_, outcome)| outcome.is_ok())
            .count(),
        1,
        "one PostgreSQL row lock must fence two different MPP credentials"
    );
    let winner_attempt = direct_outcomes
        .into_iter()
        .find(|(_, outcome)| outcome.is_ok())
        .map(|(attempt_id, _)| attempt_id)
        .expect("one direct credential should win");
    assert!(
        cross_rail_database
            .execute(
                "DELETE FROM direct_pay_sh_attempts WHERE attempt_id = $1",
                &[&winner_attempt],
            )
            .is_err(),
        "PostgreSQL must reject a migration/cascade that erases an active signed credential"
    );
    assert!(
        cross_rail_database
            .execute(
                "UPDATE direct_pay_sh_attempts
                 SET signed_transaction_base64 = 'different-credential'
                 WHERE attempt_id = $1",
                &[&winner_attempt],
            )
            .is_err(),
        "PostgreSQL must keep the exact externally authorized credential immutable"
    );
    assert!(
        cross_rail_database
            .execute(
                "UPDATE direct_pay_sh_attempts SET query_token_hash = $1
                 WHERE attempt_id = $2",
                &[&"0".repeat(64), &winner_attempt],
            )
            .is_err(),
        "PostgreSQL must not rebind a prepared purchase capability"
    );
    assert!(
        cross_rail_database
            .execute(
                "UPDATE direct_pay_sh_attempts
                 SET status = 'settled', transaction_signature = $1, completed_at = $2
                 WHERE attempt_id = $3",
                &[&"5".repeat(88), &(now_ms() as i64), &winner_attempt,],
            )
            .is_err(),
        "PostgreSQL must not hide a charge from reconciliation without its ledger commit"
    );
    let completion_barrier = Arc::new(Barrier::new(2));
    let callback_store = Store::open(&database_url).expect("callback connection should open");
    let callback_barrier = Arc::clone(&completion_barrier);
    let callback_resource = resource.clone();
    let callback_attempt = winner_attempt.clone();
    let callback_policy = policy.clone();
    let callback_token_hash = direct_token_hash.clone();
    let callback = std::thread::spawn(move || {
        callback_barrier.wait();
        callback_store.open_pay_sh_document(PayShDeliveryRequest {
            query_id: &callback_resource.query_id,
            handle: &callback_resource.document_handle,
            path_price_krw: callback_resource.price_krw,
            owner_wallet: &callback_resource.recipient_wallet,
            quote_id: &callback_resource.quote_id,
            payment_token_hash: Some(&callback_token_hash),
            research_job_id: None,
            payment_attempt_id: None,
            direct_payment_attempt_id: Some(&callback_attempt),
            policy: &callback_policy,
        })
    });
    let scanner_store = Store::open(&database_url).expect("scanner connection should open");
    let scanner_attempt = winner_attempt.clone();
    let receipt_signature = bs58::encode([91_u8; 64]).into_string();
    let scanner_signature = receipt_signature.clone();
    let scanner = std::thread::spawn(move || {
        completion_barrier.wait();
        scanner_store.settle_direct_pay_sh_payment(&scanner_attempt, &scanner_signature)
    });
    let callback_outcome = callback.join().expect("callback worker should not panic");
    let scanner_outcome = scanner.join().expect("scanner worker should not panic");
    assert!(
        callback_outcome.is_ok() || scanner_outcome.is_ok(),
        "one completion path must commit even when callback and scanner race"
    );

    // Whichever connection lost the insert race must converge on the same
    // settlement when the reconciliation worker retries.
    Store::open(&database_url)
        .expect("direct settlement connection should open")
        .settle_direct_pay_sh_payment(&winner_attempt, &receipt_signature)
        .expect("winner should settle and close the durable direct fence");

    let mut database =
        Client::connect(&database_url, NoTls).expect("counting connection should open");
    let pay_sh_reference = format!("pay.sh:{}", resource.quote_id);
    let counts = database
        .query_one(
            "SELECT
               (SELECT COUNT(*) FROM settlements
                WHERE mode = 'pay_sh_mpp_direct' AND transaction_signature = $1),
               (SELECT COUNT(*) FROM earning_events e
                JOIN settlements s ON s.id = e.settlement_id
                WHERE s.transaction_signature = $1),
               (SELECT COUNT(*) FROM memory_access_events
                WHERE purpose = 'pay_sh_paid_evidence' AND quote_id = $2)",
            &[&pay_sh_reference, &resource.quote_id],
        )
        .expect("completion counts should load");
    assert_eq!(
        counts.get::<_, i64>(0),
        1,
        "one quote must have one settlement"
    );
    assert_eq!(
        counts.get::<_, i64>(1),
        1,
        "one quote must credit earnings once"
    );
    assert_eq!(
        counts.get::<_, i64>(2),
        1,
        "one quote must record one access event"
    );

    // Race a seller's irreversible account deletion against the exact moment
    // a facilitator claims its durable pre-settlement fence. This is the
    // production-only lock ordering that SQLite's process mutex cannot prove:
    // deletion may tombstone first, or payment may fence first, but content
    // must never disappear underneath an authorized external transfer.
    let suffix = now_ms();
    let seller_id = format!("postgres-delete-seller-{suffix}");
    let seller_handle = format!("PG_DELETE_{suffix}");
    let document_id = format!("postgres-delete-document-{suffix}");
    let document_handle = format!("MDPGDELETE{suffix}");
    let deletion_query_id = format!("postgres-delete-query-{suffix}");
    let seller_wallet = bs58::encode([93_u8; 32]).into_string();
    let deletion_content = "private passage present only until deletion wins";
    let now = now_ms() as i64;
    let mut setup_database =
        Client::connect(&database_url, NoTls).expect("deletion-race setup should open");
    let mut setup_transaction = setup_database
        .transaction()
        .expect("deletion-race setup transaction should begin");
    setup_transaction
        .execute(
            "INSERT INTO users (id, email, password_hash, role, created_at)
             VALUES ($1, $2, 'integration-test-only', 'user', $3)",
            &[&seller_id, &format!("{seller_id}@test.invalid"), &now],
        )
        .expect("seller user should persist");
    setup_transaction
        .execute(
            "INSERT INTO balances
             (user_id, available_krw, reserved_krw, held_krw, updated_at)
             VALUES ($1, 0, 0, 0, $2)",
            &[&seller_id, &now],
        )
        .expect("seller balance should persist");
    setup_transaction
        .execute(
            "INSERT INTO profiles
             (user_id, handle, age_band, region, household, field, years,
              speaks_to_json, wallet, wallet_verified_at, agreed_at, consent_version,
              auto_match, agents, created_at, updated_at)
             VALUES ($1, $2, '35-44', 'seoul', 'solo', 'engineering', '7-plus',
                     '[\"engineering\"]', $3, $4, $4, 'integration.v1', 1, 0, $4, $4)",
            &[&seller_id, &seller_handle, &seller_wallet, &now],
        )
        .expect("seller profile should persist");
    setup_transaction
        .execute(
            "INSERT INTO documents
             (id, handle, author_id, shelf_id, shelf, category, content, tags_json,
              price_krw, created_at, quality_score, reliability_score, locked,
              content_hash, version)
             VALUES ($1, $2, $3, 'postgres-delete-shelf', 'Deletion race',
                     'engineering', $4, '[]', 700, $5, 1.0, 1.0, 0,
                     'postgres-delete-content-hash', 1)",
            &[
                &document_id,
                &document_handle,
                &seller_id,
                &deletion_content,
                &now,
            ],
        )
        .expect("seller document should persist");
    setup_transaction
        .execute(
            "INSERT INTO queries (id, question, decision, created_at)
             VALUES ($1, 'Can deletion race a payment fence?', 'hit', $2)",
            &[&deletion_query_id, &now],
        )
        .expect("deletion-race query should persist");
    setup_transaction
        .execute(
            "INSERT INTO query_matches (query_id, document_handle, rank, quoted_price_krw)
             VALUES ($1, $2, 1, 700)",
            &[&deletion_query_id, &document_handle],
        )
        .expect("deletion-race match should persist");
    setup_transaction
        .commit()
        .expect("deletion-race setup should commit");
    drop(setup_database);

    let deletion_quote = Store::open(&database_url)
        .expect("deletion-race quote connection should open")
        .x402_payment_quote(&deletion_query_id, &document_handle, &policy)
        .expect("seller document should become payable");
    let deletion_barrier = Arc::new(Barrier::new(2));
    let delete_store = Store::open(&database_url).expect("delete connection should open");
    let delete_seller_id = seller_id.clone();
    let delete_barrier = Arc::clone(&deletion_barrier);
    let delete_worker = std::thread::spawn(move || {
        delete_barrier.wait();
        delete_store.delete_account(&delete_seller_id)
    });
    let claim_store = Store::open(&database_url).expect("claim connection should open");
    let deletion_signed = BASE64_STANDARD.encode(prepared_x402_transaction(65));
    let claim_request = ClaimPaymentAttemptRequest {
        settlement_kind: "document".to_owned(),
        quote_id: deletion_quote.id.clone(),
        attempt_id: hex_digest(&deletion_signed),
        payer: Some(bs58::encode([66_u8; 32]).into_string()),
        signed_transaction_base64: Some(deletion_signed),
        recent_blockhash: Some(bs58::encode([67_u8; 32]).into_string()),
        absence_observed: false,
    };
    let claim_request_worker = claim_request.clone();
    let claim_worker = std::thread::spawn(move || {
        deletion_barrier.wait();
        claim_store.claim_payment_attempt(&claim_request_worker)
    });
    let delete_outcome = delete_worker
        .join()
        .expect("account-deletion worker should not panic");
    let claim_outcome = claim_worker
        .join()
        .expect("payment-claim worker should not panic");
    assert_eq!(
        usize::from(delete_outcome.is_ok()) + usize::from(claim_outcome.is_ok()),
        1,
        "exactly one of deletion and external-payment fencing may commit"
    );

    let cleanup_store = Store::open(&database_url).expect("deletion cleanup should open");
    if claim_outcome.is_ok() {
        assert!(delete_outcome.is_err());
        assert_eq!(
            cleanup_store
                .payment_document_snapshot(&deletion_quote.id)
                .expect("winning payment fence must preserve its snapshot")
                .citation
                .excerpt,
            deletion_content
        );
        assert!(
            cleanup_store
                .release_payment_attempt(&claim_request)
                .expect("canceled winning fence should release")
                .released
        );
        cleanup_store
            .delete_account(&seller_id)
            .expect("deletion should succeed after explicit cancellation");
    } else {
        assert!(delete_outcome.is_ok());
        assert!(claim_outcome.is_err());
    }
    let mut final_database =
        Client::connect(&database_url, NoTls).expect("deletion-race inspection should open");
    let final_state = final_database
        .query_one(
            "SELECT status, content_snapshot,
                    (SELECT COUNT(*) FROM users WHERE id = $2),
                    (SELECT COUNT(*) FROM chain_payment_attempts WHERE quote_id = $1)
             FROM payment_quotes WHERE id = $1",
            &[&deletion_quote.id, &seller_id],
        )
        .expect("tombstoned quote should remain auditable");
    assert_eq!(final_state.get::<_, String>(0), "deleted");
    assert_eq!(final_state.get::<_, String>(1), "");
    assert_eq!(final_state.get::<_, i64>(2), 0);
    assert_eq!(final_state.get::<_, i64>(3), 0);

    // Two separate Cloud Run processes can consume different signed challenges
    // for the same wallet simultaneously. User, signup credit, and wallet bind
    // must commit as one unit and both callers must converge on that one user.
    let wallet_suffix = now_ms();
    let wallet_digest = Sha256::digest(format!("postgres-wallet-{wallet_suffix}").as_bytes());
    let concurrent_wallet = bs58::encode(&wallet_digest[..32]).into_string();
    let concurrent_email = format!(
        "{}@wallet.obolus.local",
        wallet_digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let wallet_barrier = Arc::new(Barrier::new(2));
    let wallet_workers = [0, 1].map(|_| {
        let wallet_store = Store::open(&database_url).expect("wallet race connection should open");
        let wallet = concurrent_wallet.clone();
        let email = concurrent_email.clone();
        let barrier = Arc::clone(&wallet_barrier);
        std::thread::spawn(move || {
            barrier.wait();
            wallet_store.create_wallet_identity_user(
                &wallet,
                &email,
                "postgres-wallet-random-password-hash",
            )
        })
    });
    let wallet_outcomes =
        wallet_workers.map(|worker| worker.join().expect("wallet worker should not panic"));
    assert!(wallet_outcomes.iter().all(Result::is_ok));
    let wallet_users = wallet_outcomes.map(Result::unwrap);
    assert_eq!(
        wallet_users.iter().filter(|(_, created)| *created).count(),
        1
    );
    assert_eq!(wallet_users[0].0.id, wallet_users[1].0.id);
    let wallet_state = final_database
        .query_one(
            "SELECT
               (SELECT COUNT(*) FROM users WHERE email = $1),
               (SELECT COUNT(*) FROM balances WHERE user_id = $2),
               (SELECT COUNT(*) FROM funding_events WHERE user_id = $2),
               (SELECT COUNT(*) FROM wallet_identities WHERE wallet = $3)",
            &[&concurrent_email, &wallet_users[0].0.id, &concurrent_wallet],
        )
        .expect("concurrent wallet state should load");
    for index in 0..4 {
        assert_eq!(wallet_state.get::<_, i64>(index), 1);
    }

    // A password-reset link is a real externally visible side effect, not a
    // synthetic queue counter. Race two production-engine connections and
    // prove only one of them receives the payload that it could send.
    let notification_id = format!("postgres-email-notification-{wallet_suffix}");
    let email_id = format!("postgres-email-outbox-{wallet_suffix}");
    final_database
        .execute(
            "INSERT INTO contributor_notifications
             (id, user_id, kind, title, body, open_call_id, created_at)
             VALUES ($1, $2, 'password_reset_requested', 'Reset requested',
                     'A reset link was requested.', NULL, $3)",
            &[
                &notification_id,
                &wallet_users[0].0.id,
                &(wallet_suffix as i64),
            ],
        )
        .expect("email notification fixture should persist");
    final_database
        .execute(
            "INSERT INTO email_outbox
             (id, notification_id, recipient, subject, body, status, attempts, created_at)
             VALUES ($1, $2, $3, 'Reset your password',
                     'https://openshelf.example/reset?token=postgres-secret',
                     'pending', 0, $4)",
            &[
                &email_id,
                &notification_id,
                &concurrent_email,
                &(wallet_suffix as i64),
            ],
        )
        .expect("email outbox fixture should persist");
    let email_barrier = Arc::new(Barrier::new(2));
    let email_workers =
        ["postgres-email-worker-alpha", "postgres-email-worker-bravo"].map(|worker_id| {
            let email_store =
                Store::open(&database_url).expect("email race connection should open");
            let barrier = Arc::clone(&email_barrier);
            std::thread::spawn(move || {
                barrier.wait();
                (
                    worker_id,
                    email_store.lease_pending_emails(worker_id, 10, 60_000),
                )
            })
        });
    let email_outcomes =
        email_workers.map(|worker| worker.join().expect("email lease worker should not panic"));
    assert!(email_outcomes.iter().all(|(_, outcome)| outcome.is_ok()));
    assert_eq!(
        email_outcomes
            .iter()
            .map(|(_, outcome)| outcome.as_ref().unwrap().len())
            .sum::<usize>(),
        1,
        "PostgreSQL must expose one email payload to only one application connection"
    );
    let email_winner = email_outcomes
        .iter()
        .find(|(_, outcome)| !outcome.as_ref().unwrap().is_empty())
        .map(|(worker_id, _)| *worker_id)
        .expect("one email lease winner should exist");
    let email_loser = email_outcomes
        .iter()
        .find(|(_, outcome)| outcome.as_ref().unwrap().is_empty())
        .map(|(worker_id, _)| *worker_id)
        .expect("one email lease loser should exist");
    let email_completion_store =
        Store::open(&database_url).expect("email completion connection should open");
    assert!(
        email_completion_store
            .mark_email_failed(&email_id, email_loser, "stale response")
            .is_err(),
        "the losing process must not overwrite the winner's result"
    );
    email_completion_store
        .mark_email_delivered(&email_id, email_winner)
        .expect("the lease owner should complete delivery");
    let email_state = final_database
        .query_one(
            "SELECT status, attempts, recipient, subject, body
             FROM email_outbox WHERE id = $1",
            &[&email_id],
        )
        .expect("completed email outbox row should load");
    assert_eq!(email_state.get::<_, String>(0), "delivered");
    assert_eq!(email_state.get::<_, i64>(1), 1);
    for index in 2..=4 {
        assert_eq!(
            email_state.get::<_, String>(index),
            "",
            "delivered reset payload PII must be erased"
        );
    }
    final_database
        .execute(
            "DELETE FROM funding_events WHERE user_id = $1",
            &[&wallet_users[0].0.id],
        )
        .expect("wallet funding fixture should clean up");
    final_database
        .execute("DELETE FROM users WHERE id = $1", &[&wallet_users[0].0.id])
        .expect("wallet user fixture should clean up");

    // Two contributors can submit against the last slot from separate API
    // processes. A zero-price call is the sharpest reproducer because an
    // aggregate balance deduction cannot accidentally serialize the race.
    let answer_suffix = now_ms();
    let answer_setup = Store::open(&database_url).expect("answer-race setup should open");
    let owner = answer_setup
        .register_user(
            &format!("answer-owner-{answer_suffix}@example.com"),
            "postgres-answer-owner-hash",
        )
        .expect("answer-race owner should register");
    let mut answerer_ids = Vec::new();
    for label in ["alpha", "bravo"] {
        let answerer = answer_setup
            .register_user(
                &format!("answer-{label}-{answer_suffix}@example.com"),
                "postgres-answerer-hash",
            )
            .expect("answer-race contributor should register");
        answer_setup
            .upsert_profile(
                &answerer.id,
                &UpsertProfileRequest {
                    handle: format!("pg_{label}_{answer_suffix}"),
                    age_band: "35-44".to_owned(),
                    region: "abroad".to_owned(),
                    household: "alone".to_owned(),
                    field: "travel".to_owned(),
                    years: "7-plus".to_owned(),
                    speaks_to: vec!["travel".to_owned()],
                    wallet: None,
                    auto_match: true,
                    agents: false,
                    browser_alerts: false,
                    email_alerts: false,
                    avatar: None,
                },
            )
            .expect("answer-race contributor should onboard");
        answerer_ids.push(answerer.id);
    }
    let last_slot_call = answer_setup
        .create_open_call(
            &owner.id,
            &CreateOpenCallRequest {
                question: "Which Svalbard winter boots stayed warm during a full field day?"
                    .to_owned(),
                unit_price: 0,
                target: 1,
                chat_id: None,
                shelf: "Svalbard field work".to_owned(),
                category: "travel".to_owned(),
                filters: SearchFilters::default(),
            },
        )
        .expect("zero-price last-slot call should be created");
    drop(answer_setup);
    let answer_barrier = Arc::new(Barrier::new(2));
    let answer_workers = answerer_ids
        .into_iter()
        .map(|answerer_id| {
            let answer_store =
                Store::open(&database_url).expect("answer-race connection should open");
            let barrier = Arc::clone(&answer_barrier);
            let call_id = last_slot_call.id.clone();
            std::thread::spawn(move || {
                barrier.wait();
                answer_store.submit_answer(
                    &call_id,
                    &answerer_id,
                    "In January 2025 near Longyearbyen I wore insulated Baffin boots for six hours on packed snow. My toes stayed warm, but I removed and dried the felt liners every night because condensation froze by morning.",
                )
            })
        })
        .collect::<Vec<_>>();
    let answer_outcomes = answer_workers
        .into_iter()
        .map(|worker| worker.join().expect("answer-race worker should not panic"))
        .collect::<Vec<_>>();
    assert_eq!(
        answer_outcomes
            .iter()
            .filter(|outcome| outcome.is_ok())
            .count(),
        1,
        "exactly one contributor may consume the last open-call slot"
    );
    let answer_state = final_database
        .query_one(
            "SELECT answered, status, escrow_remaining_krw,
                    (SELECT COUNT(*) FROM memory_entries
                     WHERE open_call_id = $1),
                    (SELECT COUNT(*) FROM documents d
                     JOIN memory_entries m ON m.document_id = d.id
                     WHERE m.open_call_id = $1),
                    (SELECT COUNT(*) FROM earning_events e
                     JOIN memory_entries m ON m.id = e.memory_id
                     WHERE m.open_call_id = $1)
             FROM open_calls WHERE id = $1",
            &[&last_slot_call.id],
        )
        .expect("answer-race state should load");
    assert_eq!(answer_state.get::<_, i64>(0), 1);
    assert_eq!(answer_state.get::<_, String>(1), "filled");
    assert_eq!(answer_state.get::<_, i64>(2), 0);
    assert_eq!(answer_state.get::<_, i64>(3), 1);
    assert_eq!(answer_state.get::<_, i64>(4), 1);
    assert_eq!(answer_state.get::<_, i64>(5), 1);

    // Hold the same user-row lock that account deletion takes, then race a
    // request carrying a prepaid session that was valid just before deletion.
    // The request must wait for the deletion decision and then reject the
    // stale session. Reading only the session row would let it create a payable
    // bundle after the account had crossed its deletion boundary.
    let deletion_suffix = now_ms();
    let deletion_setup = Store::open(&database_url).expect("deletion-race setup should open");
    let deletion_question =
        format!("Which Seongsu purchases survive an account deletion race {deletion_suffix}?");
    let deletion_resolution = Resolver::new(
        deletion_setup
            .documents()
            .expect("deletion documents should load"),
    )
    .resolve(ResolveQuestionRequest {
        question: deletion_question.clone(),
        requested_documents: 2,
        budget_krw: None,
        filters: SearchFilters::default(),
    })
    .expect("deletion-race question should resolve");
    let deletion_handles = deletion_resolution
        .matches
        .iter()
        .take(2)
        .map(|matched| matched.handle.clone())
        .collect::<Vec<_>>();
    assert_eq!(deletion_handles.len(), 2);
    let deletion_token_hash = Sha256::digest(deletion_question.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    deletion_setup
        .record_resolution(
            &deletion_question,
            &deletion_resolution,
            Some(&deletion_token_hash),
        )
        .expect("deletion-race resolution should persist");
    let deletion_user = deletion_setup
        .register_user(
            &format!("deletion-race-{deletion_suffix}@example.com"),
            "postgres-deletion-race-password-hash",
        )
        .expect("deletion-race user should register");
    let deletion_wallet = bs58::encode(Sha256::digest(deletion_user.id.as_bytes())).into_string();
    deletion_setup
        .bind_wallet_identity(&deletion_user.id, &deletion_wallet)
        .expect("deletion-race wallet should bind");
    let deletion_session_token = Sha256::digest(format!("session:{deletion_suffix}").as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    deletion_setup
        .issue_prepaid_wallet_session(
            &deletion_user.id,
            &deletion_wallet,
            &deletion_session_token,
            300_000,
            &policy,
        )
        .expect("deletion-race prepaid session should persist");
    let deletion_session_hash = Sha256::digest(deletion_session_token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let stale_request = CreatePaymentBundleRequest {
        query_id: deletion_resolution.query_id.clone(),
        handles: deletion_handles,
        top_up_atomic: Some("5000000".to_owned()),
        expected_invoice_hash: None,
    };
    let stale_store = Store::open(&database_url).expect("stale-session worker should open");
    let stale_policy = policy.clone();
    let stale_token_hash = deletion_token_hash.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (outcome_tx, outcome_rx) = mpsc::channel();

    let mut deletion_lock =
        Client::connect(&database_url, NoTls).expect("deletion lock connection should open");
    deletion_lock
        .batch_execute("BEGIN")
        .expect("deletion transaction should begin");
    deletion_lock
        .query_one(
            "SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
            &[&deletion_user.id],
        )
        .expect("deletion should lock the active user");
    deletion_lock
        .execute(
            "UPDATE users SET deleted_at = $1 WHERE id = $2",
            &[&(deletion_suffix as i64), &deletion_user.id],
        )
        .expect("deletion boundary should be staged");
    let stale_worker = std::thread::spawn(move || {
        started_tx
            .send(())
            .expect("stale-session start signal should send");
        let outcome = stale_store.create_payment_bundle(
            &stale_request,
            &stale_token_hash,
            &deletion_session_hash,
            &stale_policy,
        );
        outcome_tx
            .send(outcome)
            .expect("stale-session outcome should send");
    });
    started_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("stale-session worker should start");
    assert!(
        matches!(
            outcome_rx.recv_timeout(Duration::from_millis(250)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ),
        "prepaid bundle creation must wait on the account-deletion user lock"
    );
    deletion_lock
        .batch_execute("COMMIT")
        .expect("deletion boundary should commit");
    let stale_outcome = outcome_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("stale-session worker should finish after deletion commits");
    assert!(
        stale_outcome.is_err(),
        "a session copied before account deletion must not create a payable bundle afterward"
    );
    stale_worker
        .join()
        .expect("stale-session worker should not panic");
    let surviving_quotes = final_database
        .query_one(
            "SELECT COUNT(*) FROM payment_bundle_quotes
             WHERE query_id = $1 AND status = 'quoted'",
            &[&deletion_resolution.query_id],
        )
        .expect("deletion-race quote cardinality should load")
        .get::<_, i64>(0);
    assert_eq!(surviving_quotes, 0);

    // Two administrators can approve the same pending dispute from different
    // Cloud Run instances. The call deliberately has spare capacity and a
    // zero price, so neither balance deductions nor a filled-call transition
    // can accidentally serialize the race for us.
    let dispute_suffix = now_ms();
    let dispute_setup = Store::open(&database_url).expect("dispute-race setup should open");
    let dispute_owner = dispute_setup
        .register_user(
            &format!("dispute-owner-{dispute_suffix}@example.com"),
            "postgres-dispute-owner-hash",
        )
        .expect("dispute-race owner should register");
    let dispute_author = dispute_setup
        .register_user(
            &format!("dispute-author-{dispute_suffix}@example.com"),
            "postgres-dispute-author-hash",
        )
        .expect("dispute-race author should register");
    dispute_setup
        .upsert_profile(
            &dispute_author.id,
            &UpsertProfileRequest {
                handle: format!("pg_dispute_author_{dispute_suffix}"),
                age_band: "35-44".to_owned(),
                region: "abroad".to_owned(),
                household: "alone".to_owned(),
                field: "travel".to_owned(),
                years: "7-plus".to_owned(),
                speaks_to: vec!["travel".to_owned()],
                wallet: None,
                auto_match: true,
                agents: false,
                browser_alerts: false,
                email_alerts: false,
                avatar: None,
            },
        )
        .expect("dispute-race author should onboard");
    let mut reviewer_ids = Vec::new();
    for label in ["alpha", "bravo"] {
        let reviewer = dispute_setup
            .register_user(
                &format!("dispute-reviewer-{label}-{dispute_suffix}@example.com"),
                "postgres-dispute-reviewer-hash",
            )
            .expect("dispute reviewer should register");
        dispute_setup
            .set_user_role(&reviewer.id, "admin")
            .expect("dispute reviewer should become admin");
        reviewer_ids.push(reviewer.id);
    }
    let disputed_call = dispute_setup
        .create_open_call(
            &dispute_owner.id,
            &CreateOpenCallRequest {
                question: "Which Svalbard boot claim needs a manual evidence ruling?".to_owned(),
                unit_price: 0,
                target: 2,
                chat_id: None,
                shelf: "Svalbard field work".to_owned(),
                category: "travel".to_owned(),
                filters: SearchFilters::default(),
            },
        )
        .expect("dispute-race call should be created");
    let voided = dispute_setup
        .submit_answer(
            &disputed_call.id,
            &dispute_author.id,
            "They are good boots.",
        )
        .expect("weak answer should be stored for dispute");
    assert_eq!(voided.memory.status, "voided");
    dispute_setup
        .submit_dispute(
            &voided.memory.id,
            &dispute_author.id,
            "The terse answer identifies the tested product, and a human reviewer can inspect the supporting field context.",
        )
        .expect("dispute should be pending");
    drop(dispute_setup);

    let dispute_barrier = Arc::new(Barrier::new(2));
    let dispute_workers = reviewer_ids
        .into_iter()
        .map(|reviewer_id| {
            let review_store =
                Store::open(&database_url).expect("dispute-race connection should open");
            let barrier = Arc::clone(&dispute_barrier);
            let memory_id = voided.memory.id.clone();
            std::thread::spawn(move || {
                barrier.wait();
                review_store.review_dispute(
                    &reviewer_id,
                    &memory_id,
                    &ReviewDisputeRequest {
                        decision: "approved".to_owned(),
                        note: "Manual review confirms enough product-specific field evidence."
                            .to_owned(),
                    },
                )
            })
        })
        .collect::<Vec<_>>();
    let dispute_outcomes = dispute_workers
        .into_iter()
        .map(|worker| worker.join().expect("dispute-race worker should not panic"))
        .collect::<Vec<_>>();
    assert_eq!(
        dispute_outcomes
            .iter()
            .filter(|outcome| outcome.is_ok())
            .count(),
        1,
        "exactly one administrator may restore a disputed answer"
    );
    let dispute_state = final_database
        .query_one(
            "SELECT c.answered, c.status, m.status, d.status,
                    (SELECT COUNT(*) FROM documents doc WHERE doc.id = m.document_id),
                    (SELECT COUNT(*) FROM earning_events e WHERE e.memory_id = m.id)
             FROM open_calls c
             JOIN memory_entries m ON m.open_call_id = c.id
             JOIN dispute_events d ON d.memory_id = m.id
             WHERE c.id = $1 AND m.id = $2",
            &[&disputed_call.id, &voided.memory.id],
        )
        .expect("dispute-race state should load");
    assert_eq!(dispute_state.get::<_, i64>(0), 1);
    assert_eq!(dispute_state.get::<_, String>(1), "open");
    assert_eq!(dispute_state.get::<_, String>(2), "settled");
    assert_eq!(dispute_state.get::<_, String>(3), "approved");
    assert_eq!(dispute_state.get::<_, i64>(4), 1);
    assert_eq!(dispute_state.get::<_, i64>(5), 1);

    // Reproduce a torn/manual payout migration in the production engine: the
    // signature was stored, but the exact signed bytes were not. This state may
    // represent a transfer that already left the process, so a replacement
    // signer must neither lease nor re-sign it, and readiness must expose it.
    let payout_suffix = now_ms();
    let partial_claim_id = format!("postgres-torn-payout-{payout_suffix}");
    let mut escrow_seed = Sha256::digest(partial_claim_id.as_bytes()).to_vec();
    escrow_seed.truncate(32);
    let partial_escrow = bs58::encode(escrow_seed).into_string();
    let partial_recipient = bs58::encode([96_u8; 32]).into_string();
    let partial_signature = bs58::encode([97_u8; 64]).into_string();
    final_database
        .execute(
            "INSERT INTO payout_claims
             (id, beneficiary_user_id, kind, escrow_wallet, recipient_wallet,
              asset, network, amount_atomic, amount_krw, status,
              transaction_signature, attempt_count, created_at, updated_at)
             VALUES ($1, 'postgres-torn-beneficiary', 'open_call_refund', $2, $3,
                     $4, $5, 1000, 1, 'prepared', $6, 1, $7, $7)",
            &[
                &partial_claim_id,
                &partial_escrow,
                &partial_recipient,
                &policy.asset,
                &policy.network,
                &partial_signature,
                &(payout_suffix as i64),
            ],
        )
        .expect("torn payout fixture should persist in PostgreSQL");
    let payout_store = Store::open(&database_url).expect("payout readiness connection should open");
    assert!(
        payout_store
            .lease_payout_claims(
                "postgres-repair-worker",
                &partial_escrow,
                &policy.network,
                20,
                60_000,
            )
            .expect("torn payout lease scan should complete")
            .is_empty(),
        "PostgreSQL must never lease a partial prepared transaction for re-signing"
    );
    let partial_backlog = payout_store
        .payout_claim_backlogs()
        .expect("PostgreSQL payout backlog should load")
        .into_iter()
        .find(|backlog| backlog.escrow_wallet == partial_escrow)
        .expect("the torn signer liability must remain visible");
    assert_eq!(partial_backlog.blocked_count, 1);
    final_database
        .execute(
            "DELETE FROM payout_claims WHERE id = $1",
            &[&partial_claim_id],
        )
        .expect("torn payout fixture should be cleaned up");

    // A restore sweep runs through a third PostgreSQL connection while a stale
    // Cloud Run revision can still hold a live pool. The database trigger, not
    // process memory or readiness routing, must reject that stale writer. Once
    // external receipts are explicitly reconciled, the same untouched quote
    // becomes claimable without deleting the incident audit trail.
    let hold_suffix = now_ms();
    let hold_question =
        format!("Can a stale PostgreSQL writer escape a Seongsu lunch restore hold {hold_suffix}?");
    let hold_store = Store::open(&database_url).expect("restore-hold setup should open");
    let hold_resolution = Resolver::new(
        hold_store
            .documents()
            .expect("restore-hold documents should load"),
    )
    .resolve(ResolveQuestionRequest {
        question: hold_question.clone(),
        requested_documents: 1,
        budget_krw: None,
        filters: SearchFilters::default(),
    })
    .expect("restore-hold question should resolve");
    hold_store
        .record_resolution(&hold_question, &hold_resolution, None)
        .expect("restore-hold resolution should persist");
    let hold_quote = hold_store
        .x402_payment_quote(
            &hold_resolution.query_id,
            &hold_resolution.matches[0].handle,
            &policy,
        )
        .expect("restore-hold quote should persist");
    let hold_signed = BASE64_STANDARD.encode(prepared_x402_transaction(98));
    let hold_request = ClaimPaymentAttemptRequest {
        settlement_kind: "document".to_owned(),
        quote_id: hold_quote.id.clone(),
        attempt_id: hex_digest(&hold_signed),
        payer: Some(bs58::encode([99_u8; 32]).into_string()),
        signed_transaction_base64: Some(hold_signed.clone()),
        recent_blockhash: Some(bs58::encode([100_u8; 32]).into_string()),
        absence_observed: false,
    };
    let recovery_id = format!("postgres-restore-{hold_suffix}");
    let mut sweep = RollbackSweepLedger::connect_postgres(&database_url)
        .expect("restore sweep should own an independent PostgreSQL connection");
    assert!(
        sweep
            .install_window_hold(&recovery_id, hold_suffix - 1, hold_suffix)
            .expect("restore window hold should install")
    );
    assert!(
        hold_store.ready().is_err(),
        "readiness must remove a held revision from service"
    );
    assert!(
        hold_store.claim_payment_attempt(&hold_request).is_err(),
        "current code must reject a new external side effect while held"
    );
    let stale_insert = final_database.execute(
        "INSERT INTO chain_payment_attempts
         (settlement_kind, quote_id, attempt_id, payer_wallet,
          signed_transaction_base64, recent_blockhash, reconcile_after, created_at)
         VALUES ('document', $1, $2, $3, $4, $5, $6, $7)",
        &[
            &hold_quote.id,
            &hold_request.attempt_id,
            &hold_request.payer,
            &hold_request.signed_transaction_base64,
            &hold_request.recent_blockhash,
            &((hold_suffix + 60_000) as i64),
            &(hold_suffix as i64),
        ],
    );
    assert!(
        stale_insert.is_err(),
        "a stale revision with no hold-aware application code must be stopped by PostgreSQL"
    );
    assert_eq!(
        sweep
            .resolve_recovery_holds(
                &recovery_id,
                "incident://postgres-contract/external-receipts-reviewed",
            )
            .expect("explicit reconciliation should resolve the hold"),
        1
    );
    hold_store
        .claim_payment_attempt(&hold_request)
        .expect("the unchanged quote should become claimable after explicit resolution");
    assert!(
        hold_store
            .release_payment_attempt(&hold_request)
            .expect("restore-hold payment fixture should release")
            .released
    );
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock should follow the Unix epoch")
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn hex_digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn prepared_x402_transaction(payer_signature_byte: u8) -> Vec<u8> {
    let mut transaction = vec![42_u8; 180];
    transaction[0] = 2;
    transaction[1..65].fill(0);
    transaction[65..129].fill(payer_signature_byte);
    transaction
}
