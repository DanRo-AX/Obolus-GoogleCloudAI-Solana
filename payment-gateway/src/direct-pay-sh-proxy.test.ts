import assert from "node:assert/strict";
import test from "node:test";
import { base58 } from "@scure/base";
import { Challenge, Credential, Receipt } from "mppx";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  DIRECT_PAY_ATTEMPT_HEADER,
  PAY_SH_FRONT_TOKEN_HEADER,
  PayShProxyError,
  createDirectPayShRecipientAccountProbe,
  directPayShRecipientTokenAccount,
  proxyPayShRequest,
  type DirectPayShProxyDependencies,
  type DirectPayShQuote,
} from "./direct-pay-sh-proxy.js";

const operator = Keypair.generate();
const owner = Keypair.generate();
const attacker = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const associatedTokenProgram = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const path = `/api/v2/pay-sh/documents/700/query-real/doc-real`
  + `?owner_wallet=${owner.publicKey.toBase58()}&quote_id=quote-real`;

function quote(expiresAt = Date.now() + 10 * 60_000): DirectPayShQuote {
  return {
    id: "quote-real",
    queryId: "query-real",
    documentHandle: "doc-real",
    payTo: owner.publicKey.toBase58(),
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amountAtomic: "30",
    priceKrw: 700,
    expiresAt,
    status: "quoted",
  };
}

function credential(
  payer = Keypair.generate(),
  expiresAt = Date.now() + 5 * 60_000,
  currency = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  transactionBlockhash = blockhash,
  transactionKind: "quoted-usdc" | "misdirected-usdc" | "excessive-priority-fee" = "quoted-usdc",
): string {
  const transaction = new Transaction({
    feePayer: operator.publicKey,
    recentBlockhash: transactionBlockhash,
  });
  if (transactionKind === "excessive-priority-fee") {
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_001n }));
  }
  transaction.add(
    transferChecked(payer.publicKey, operator.publicKey, 1n),
    new TransactionInstruction({
      programId: memoProgram,
      keys: [],
      data: Buffer.from("human-document-krw-700#real"),
    }),
    transferChecked(
      payer.publicKey,
      transactionKind === "misdirected-usdc" ? attacker.publicKey : owner.publicKey,
      29n,
    ),
  );
  transaction.partialSign(payer);
  const signedTransactionBase64 = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString("base64");
  const challenge = Challenge.from({
    id: `challenge-${payer.publicKey.toBase58()}`,
    realm: "pay.example",
    method: "solana",
    intent: "charge",
    expires: new Date(expiresAt).toISOString(),
    request: {
      amount: "30",
      currency,
      recipient: operator.publicKey.toBase58(),
      externalId: "human-document-krw-700#real",
      methodDetails: {
        network: "devnet",
        feePayer: true,
        feePayerKey: operator.publicKey.toBase58(),
        recentBlockhash: blockhash,
        splits: [{ recipient: owner.publicKey.toBase58(), amount: "29" }],
      },
    },
  });
  return Credential.serialize({
    challenge,
    payload: { type: "transaction", transaction: signedTransactionBase64 },
  });
}

function transferChecked(
  payer: PublicKey,
  recipient: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: associatedTokenAddress(payer), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: associatedTokenAddress(recipient), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function associatedTokenAddress(ownerAddress: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ownerAddress.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  )[0];
}

function dependencies(
  overrides: Partial<DirectPayShProxyDependencies> = {},
): DirectPayShProxyDependencies {
  return {
    privatePayShBase: "https://private-pay.example",
    frontToken: "front-secret",
    operatorWallet: operator.publicKey.toBase58(),
    loadQuote: async () => quote(),
    recipientAssetAccountReady: async () => true,
    bindChallenges: async () => undefined,
    prepareDirect: async () => undefined,
    prepareResearch: async () => undefined,
    recordDirectReceipt: async () => undefined,
    recordResearchReceipt: async () => undefined,
    receiptFinalized: async () => true,
    fetchImpl: async (_input, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (!authorization) return new Response("ok");
      return new Response("ok", {
        headers: {
          "payment-receipt": Receipt.serialize({
            method: "solana",
            reference: signatureFromCredential(authorization),
            status: "success",
            timestamp: new Date().toISOString(),
          }),
        },
      });
    },
    ...overrides,
  };
}

function paidHeaders(authorization: string): Headers {
  return new Headers({
    authorization,
    "x-openshelf-query-token": "query-capability",
  });
}

function signatureFromCredential(authorization: string): string {
  const parsed = Credential.deserialize<{ type: "transaction"; transaction: string }>(
    authorization,
  );
  const transaction = Transaction.from(Buffer.from(parsed.payload.transaction, "base64"));
  transaction.partialSign(operator);
  const signature = transaction.signatures[0]?.signature;
  assert.ok(signature);
  return base58.encode(signature);
}

function challengeHeaderFromCredential(authorization: string): string {
  return Challenge.serialize(Credential.deserialize(authorization).challenge);
}

function paidUpstreamResponse(init: RequestInit | undefined, body = "ok"): Response {
  const authorization = new Headers(init?.headers).get("authorization");
  assert.ok(authorization);
  return new Response(body, {
    headers: {
      "payment-receipt": Receipt.serialize({
        method: "solana",
        reference: signatureFromCredential(authorization),
        status: "success",
        timestamp: new Date().toISOString(),
      }),
    },
  });
}

test("the official Pay.sh transport cannot start before direct credential persistence", async () => {
  const authorization = credential();
  const receiptSignature = signatureFromCredential(authorization);
  let releasePrepare: (() => void) | undefined;
  const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
  let observePrepare: (() => void) | undefined;
  const prepareStarted = new Promise<void>((resolve) => { observePrepare = resolve; });
  let persistedAttempt = "";
  let upstreamStarted = false;
  let upstreamHeaders: Headers | undefined;
  let recordedReceipt: string | undefined;
  const request = proxyPayShRequest(
    {
      method: "GET",
      pathAndQuery: path,
      headers: new Headers({
        ...Object.fromEntries(paidHeaders(authorization)),
        [DIRECT_PAY_ATTEMPT_HEADER]: "caller-spoofed-attempt",
        [PAY_SH_FRONT_TOKEN_HEADER]: "caller-spoofed-front-token",
        "x-openshelf-internal-token": "caller-spoofed-internal-token",
      }),
    },
    dependencies({
      prepareDirect: async (attemptId) => {
        persistedAttempt = attemptId;
        observePrepare?.();
        await prepareGate;
      },
      fetchImpl: async (_input, init) => {
        upstreamStarted = true;
        assert.ok(init?.signal, "private Pay.sh transport must have a finite deadline");
        upstreamHeaders = new Headers(init?.headers);
        return new Response("ok", {
          headers: {
            "payment-receipt": Receipt.serialize({
              method: "solana",
              reference: receiptSignature,
              status: "success",
              timestamp: new Date().toISOString(),
            }),
          },
        });
      },
      recordDirectReceipt: async (attemptId, signature) => {
        recordedReceipt = `${attemptId}:${signature}`;
      },
    }),
  );

  await prepareStarted;
  assert.match(persistedAttempt, /^[0-9a-f]{64}$/);
  assert.equal(upstreamStarted, false, "paid credential escaped before the durable commit");
  releasePrepare?.();
  assert.equal((await request).status, 200);
  assert.equal(upstreamHeaders?.get(DIRECT_PAY_ATTEMPT_HEADER), persistedAttempt);
  assert.equal(upstreamHeaders?.get(PAY_SH_FRONT_TOKEN_HEADER), "front-secret");
  assert.equal(upstreamHeaders?.has("x-openshelf-internal-token"), false);
  assert.equal(recordedReceipt, `${persistedAttempt}:${receiptSignature}`);
});

test("a 402 challenge is not exposed before its quote binding is durable", async () => {
  const authorization = credential();
  let releaseBinding: (() => void) | undefined;
  const bindingGate = new Promise<void>((resolve) => { releaseBinding = resolve; });
  let observeBinding: (() => void) | undefined;
  const bindingStarted = new Promise<void>((resolve) => { observeBinding = resolve; });
  let completed = false;
  const pending = proxyPayShRequest(
    {
      method: "GET",
      pathAndQuery: path,
      headers: new Headers({ "x-openshelf-query-token": "query-capability" }),
    },
    dependencies({
      fetchImpl: async () => new Response("payment required", {
        status: 402,
        headers: { "www-authenticate": challengeHeaderFromCredential(authorization) },
      }),
      bindChallenges: async (queryToken, request) => {
        assert.equal(queryToken, "query-capability");
        assert.equal(request.quoteId, "quote-real");
        assert.equal(request.challenges.length, 1);
        assert.equal(
          request.challenges[0]?.challengeId,
          Credential.deserialize(authorization).challenge.id,
        );
        observeBinding?.();
        await bindingGate;
      },
    }),
  ).then((response) => {
    completed = true;
    return response;
  });

  await bindingStarted;
  await Promise.resolve();
  assert.equal(completed, false, "the caller observed 402 before the database commit");
  releaseBinding?.();
  assert.equal((await pending).status, 402);
});

test("a receipt that names another resource cannot settle the prepared attempt", async () => {
  let receiptWrites = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        fetchImpl: async () => new Response("wrong receipt", {
          headers: {
            "payment-receipt": Receipt.serialize({
              method: "solana",
              reference: "1".repeat(64),
              externalId: "human-document-krw-700#another",
              status: "success",
              timestamp: new Date().toISOString(),
            }),
          },
        }),
        recordDirectReceipt: async () => { receiptWrites += 1; },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_payment_receipt",
  );
  assert.equal(receiptWrites, 0);
});

test("a syntactically valid but unauthenticated receipt cannot settle", async () => {
  const authorization = credential();
  let receiptWrites = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(authorization) },
      dependencies({
        fetchImpl: async () => new Response("forged receipt", {
          headers: {
            "payment-receipt": Receipt.serialize({
              method: "solana",
              reference: base58.encode(new Uint8Array(64).fill(9)),
              status: "success",
              timestamp: new Date().toISOString(),
            }),
          },
        }),
        recordDirectReceipt: async () => { receiptWrites += 1; },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_payment_receipt",
  );
  assert.equal(receiptWrites, 0);
});

test("an expired copied URL is rejected before either persistence or external charge", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        loadQuote: async () => quote(Date.now() - 1),
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "expired_quote",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("a seller-deleted quote can never reach the external charging gate", async () => {
  let recipientChecks = 0;
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        loadQuote: async () => ({ ...quote(), status: "deleted" }),
        recipientAssetAccountReady: async () => {
          recipientChecks += 1;
          return true;
        },
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "quote_not_payable",
  );
  assert.equal(recipientChecks, 0);
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("a challenge cannot pin absence checks to another transaction blockhash", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: path,
        headers: paidHeaders(credential(
          Keypair.generate(),
          Date.now() + 5 * 60_000,
          quote().asset,
          Keypair.generate().publicKey.toBase58(),
        )),
      },
      dependencies({
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "recent_blockhash_mismatch",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("a validly signed USDC payment redirected from the owner cannot become recovery evidence", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: path,
        headers: paidHeaders(credential(
          Keypair.generate(),
          Date.now() + 5 * 60_000,
          quote().asset,
          blockhash,
          "misdirected-usdc",
        )),
      },
      dependencies({
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_payment_transaction",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("a buyer cannot make the service fee payer fund an excessive priority fee", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: path,
        headers: paidHeaders(credential(
          Keypair.generate(),
          Date.now() + 5 * 60_000,
          quote().asset,
          blockhash,
          "excessive-priority-fee",
        )),
      },
      dependencies({
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_payment_transaction",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("an invalid query capability is rejected durably before the collector can charge", async () => {
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        prepareDirect: async (_attemptId, queryToken) => {
          assert.equal(queryToken, "query-capability");
          throw new PayShProxyError(
            401,
            "invalid_query_token",
            "The query capability expired before payment.",
          );
        },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_query_token",
  );
  assert.equal(upstreamCalls, 0);
});

test("unrecognized and malformed authorization cannot bypass the public payment fence", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  for (const authorization of [
    "Bearer parser-differential-payload",
    "Payment parser-differential-payload",
  ]) {
    await assert.rejects(
      proxyPayShRequest(
        {
          method: "GET",
          pathAndQuery: path,
          headers: new Headers({
            authorization,
            "x-openshelf-query-token": "query-capability",
          }),
        },
        dependencies({
          prepareDirect: async () => { prepares += 1; },
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response("should not happen");
          },
        }),
      ),
      (error: unknown) => error instanceof PayShProxyError
        && ["unrecognized_payment_credential", "malformed_credential"].includes(error.code),
    );
  }
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("an owner without a USDC token account is rejected before persistence or collection", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        recipientAssetAccountReady: async (loadedQuote) => {
          assert.equal(
            await directPayShRecipientTokenAccount(loadedQuote.asset, loadedQuote.payTo),
            await directPayShRecipientTokenAccount(quote().asset, owner.publicKey.toBase58()),
          );
          return false;
        },
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "recipient_asset_account_missing",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("an unpaid probe cannot advertise a challenge for a missing recipient account", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: path,
        headers: new Headers({ "x-openshelf-query-token": "query-capability" }),
      },
      dependencies({
        recipientAssetAccountReady: async () => false,
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not advertise a challenge");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "recipient_asset_account_missing",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("an unauthenticated recipient preflight cannot amplify one RPC throttle into retries", async () => {
  let rpcCalls = 0;
  const probe = createDirectPayShRecipientAccountProbe(
    "https://rpc.example",
    1_000,
    (async () => {
      rpcCalls += 1;
      return Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: 429, message: "throttled" } },
        { status: 429 },
      );
    }) as typeof fetch,
  );

  await assert.rejects(probe(quote()), /HTTP 429/);
  assert.equal(rpcCalls, 1);
});

test("free and retired proxy routes never forward a caller payment credential", async () => {
  let forwardedAuthorization: string | null | undefined;
  const response = await proxyPayShRequest(
    {
      method: "GET",
      pathAndQuery: "/api/v1/questions/query-real/pay-sh-resources/doc-real",
      headers: paidHeaders(credential()),
    },
    dependencies({
      fetchImpl: async (_input, init) => {
        forwardedAuthorization = new Headers(init?.headers).get("authorization");
        return new Response("free metadata");
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(forwardedAuthorization, null);
});

test("only the fenced MPP credential survives the public payment header boundary", async () => {
  const poison = paidHeaders(credential());
  poison.set("cookie", "pay_session=attacker");
  poison.set("proxy-authorization", "Basic attacker");
  poison.set("x-payment", "alternate-unfenced-payment");
  poison.set("payment-signature", "alternate-signature");
  poison.set("x-forwarded-host", "attacker.example");
  let forwarded: Headers | undefined;

  const response = await proxyPayShRequest(
    { method: "GET", pathAndQuery: path, headers: poison },
    dependencies({
      fetchImpl: async (_input, init) => {
        forwarded = new Headers(init?.headers);
        return new Response("challenge rejected", { status: 402 });
      },
    }),
  );

  assert.equal(response.status, 402);
  assert.ok(forwarded?.has("authorization"));
  assert.equal(forwarded?.get(PAY_SH_FRONT_TOKEN_HEADER), "front-secret");
  for (const name of [
    "cookie",
    "proxy-authorization",
    "x-payment",
    "payment-signature",
    "x-forwarded-host",
    "x-openshelf-internal-token",
  ]) {
    assert.equal(forwarded?.has(name), false, `${name} must be stripped`);
  }
});

test("a rejected paid upstream body is actively cancelled", async () => {
  let cancelled = false;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        fetchImpl: async () => new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("private body must not remain open"));
          },
          cancel() {
            cancelled = true;
          },
        })),
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "missing_payment_receipt",
  );
  assert.equal(cancelled, true);
});

test("proxy-form targets cannot exfiltrate the front token or payment credential", async () => {
  let upstreamCalls = 0;
  for (const target of [
    `https://attacker.example${path}`,
    `//attacker.example${path}`,
    `/\\attacker.example${path}`,
    `${path}#ignored-by-http`,
  ]) {
    await assert.rejects(
      proxyPayShRequest(
        { method: "GET", pathAndQuery: target, headers: paidHeaders(credential()) },
        dependencies({
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response("credential leaked");
          },
        }),
      ),
      (error: unknown) => error instanceof PayShProxyError
        && error.code === "invalid_proxy_target",
    );
  }
  assert.equal(upstreamCalls, 0);
});

test("duplicate quote parameters cannot split proxy and callback interpretation", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: `${path}&quote_id=attacker-selected-quote`,
        headers: paidHeaders(credential()),
      },
      dependencies({
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "invalid_pay_sh_url",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("a backend asset drift cannot be charged through the fixed Devnet USDC rail", async () => {
  let prepares = 0;
  let upstreamCalls = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: path,
        headers: paidHeaders(credential(
          Keypair.generate(),
          Date.now() + 5 * 60_000,
          owner.publicKey.toBase58(),
        )),
      },
      dependencies({
        loadQuote: async () => ({ ...quote(), asset: owner.publicKey.toBase58() }),
        prepareDirect: async () => { prepares += 1; },
        fetchImpl: async () => {
          upstreamCalls += 1;
          return new Response("should not happen");
        },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "asset_mismatch",
  );
  assert.equal(prepares, 0);
  assert.equal(upstreamCalls, 0);
});

test("two different signed payments racing for one quote can start only one charge", async () => {
  let activeAttempt: string | undefined;
  let upstreamCalls = 0;
  const deps = dependencies({
    prepareDirect: async (attemptId) => {
      if (!activeAttempt) activeAttempt = attemptId;
      else if (activeAttempt !== attemptId) {
        throw new PayShProxyError(409, "attempt_conflict", "quote already fenced");
      }
    },
    fetchImpl: async (_input, init) => {
      upstreamCalls += 1;
      return paidUpstreamResponse(init);
    },
  });
  const results = await Promise.allSettled([
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      deps,
    ),
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      deps,
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(upstreamCalls, 1);
});

test("a crash after prepare permits only the identical transaction to resume", async () => {
  const firstCredential = credential();
  let activeAttempt: string | undefined;
  let upstreamCalls = 0;
  const deps = dependencies({
    prepareDirect: async (attemptId) => {
      if (!activeAttempt) activeAttempt = attemptId;
      else if (activeAttempt !== attemptId) {
        throw new PayShProxyError(409, "attempt_conflict", "quote already fenced");
      }
    },
    fetchImpl: async (_input, init) => {
      upstreamCalls += 1;
      if (upstreamCalls === 1) throw new Error("process died before upstream response");
      return paidUpstreamResponse(init, "recovered");
    },
  });

  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(firstCredential) },
      deps,
    ),
    /process died/,
  );
  assert.equal(
    (await proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(firstCredential) },
      deps,
    )).status,
    200,
  );
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      deps,
    ),
    /quote already fenced/,
  );
  assert.equal(upstreamCalls, 2, "a different signed transfer reached the official gate");
});

test("a successful Pay.sh response without a chain receipt is held for recovery", async () => {
  let receiptWrites = 0;
  let postReceiptFailpoints = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        fetchImpl: async () => new Response("delivered-without-receipt", { status: 200 }),
        afterDirectReceipt: async () => { postReceiptFailpoints += 1; },
        recordDirectReceipt: async () => { receiptWrites += 1; },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "missing_payment_receipt",
  );
  assert.equal(receiptWrites, 0);
  assert.equal(postReceiptFailpoints, 0);
});

test("an upstream rejection cannot masquerade as the post-collection crash point", async () => {
  let postReceiptFailpoints = 0;
  const response = await proxyPayShRequest(
    { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
    dependencies({
      fetchImpl: async () => new Response("collector rejected payment", { status: 402 }),
      afterDirectReceipt: async () => { postReceiptFailpoints += 1; },
    }),
  );
  assert.equal(response.status, 402);
  assert.equal(postReceiptFailpoints, 0);
});

test("a valid Pay.sh receipt from one optimistic provider cannot release content", async () => {
  let finalityChecks = 0;
  let receiptWrites = 0;
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: path, headers: paidHeaders(credential()) },
      dependencies({
        receiptFinalized: async () => {
          finalityChecks += 1;
          return false;
        },
        recordDirectReceipt: async () => { receiptWrites += 1; },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "payment_finality_pending",
  );
  assert.equal(finalityChecks, 1);
  assert.equal(receiptWrites, 0);
});

test("a public caller cannot disguise a payment as a funded research attempt", async () => {
  const researchPath = `${path}&research_job_id=job-secret`
    + `&payment_attempt_id=${"a".repeat(64)}`;
  const authorization = credential();
  let researchPrepares = 0;
  let researchReceipts = 0;
  let directPrepares = 0;
  let upstreamCalls = 0;
  const deps = dependencies({
    researchAuthorizationToken: "orchestrator-secret",
    prepareResearch: async () => { researchPrepares += 1; },
    prepareDirect: async () => { directPrepares += 1; },
    fetchImpl: async (_input, init) => {
      upstreamCalls += 1;
      return paidUpstreamResponse(init);
    },
    recordResearchReceipt: async (jobId, attemptId, receipt) => {
      assert.equal(jobId, "job-secret");
      assert.equal(attemptId, "a".repeat(64));
      assert.match(receipt, /^[1-9A-HJ-NP-Za-km-z]{64,128}$/);
      researchReceipts += 1;
    },
  });
  await assert.rejects(
    proxyPayShRequest(
      { method: "GET", pathAndQuery: researchPath, headers: new Headers({ authorization }) },
      deps,
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "research_proxy_unauthorized",
  );
  assert.equal(researchPrepares, 0);
  assert.equal(directPrepares, 0);
  assert.equal(upstreamCalls, 0);

  const authorizedHeaders = new Headers({
    authorization,
    "x-openshelf-internal-token": "orchestrator-secret",
  });
  assert.equal(
    (await proxyPayShRequest(
      { method: "GET", pathAndQuery: researchPath, headers: authorizedHeaders },
      deps,
    )).status,
    200,
  );
  assert.equal(researchPrepares, 1);
  assert.equal(directPrepares, 0);
  assert.equal(upstreamCalls, 1);
  assert.equal(researchReceipts, 1);
});

test("a research callback body is not released when Pay.sh omits its chain receipt", async () => {
  const researchPath = `${path}&research_job_id=job-secret`
    + `&payment_attempt_id=${"b".repeat(64)}`;
  let receiptWrites = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: researchPath,
        headers: new Headers({
          authorization: credential(),
          "x-openshelf-internal-token": "orchestrator-secret",
        }),
      },
      dependencies({
        researchAuthorizationToken: "orchestrator-secret",
        fetchImpl: async () => new Response(
          JSON.stringify({ citations: [{ excerpt: "private paid content" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
        recordResearchReceipt: async () => { receiptWrites += 1; },
      }),
    ),
    (error: unknown) => error instanceof PayShProxyError
      && error.code === "missing_payment_receipt",
  );
  assert.equal(receiptWrites, 0);
});

test("a valid research receipt is still held when the durable ledger commit is unavailable", async () => {
  const researchPath = `${path}&research_job_id=job-secret`
    + `&payment_attempt_id=${"c".repeat(64)}`;
  let upstreamCalls = 0;
  let receiptWrites = 0;
  await assert.rejects(
    proxyPayShRequest(
      {
        method: "GET",
        pathAndQuery: researchPath,
        headers: new Headers({
          authorization: credential(),
          "x-openshelf-internal-token": "orchestrator-secret",
        }),
      },
      dependencies({
        researchAuthorizationToken: "orchestrator-secret",
        fetchImpl: async (_input, init) => {
          upstreamCalls += 1;
          return paidUpstreamResponse(init, JSON.stringify({
            citations: [{ excerpt: "private paid content" }],
          }));
        },
        recordResearchReceipt: async () => {
          receiptWrites += 1;
          throw new Error("Rust ledger connection reset before commit response");
        },
      }),
    ),
    /Rust ledger connection reset/,
  );
  assert.equal(upstreamCalls, 1);
  assert.equal(receiptWrites, 1);
});
