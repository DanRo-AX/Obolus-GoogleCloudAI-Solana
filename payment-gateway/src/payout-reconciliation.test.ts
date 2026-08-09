import assert from "node:assert/strict";
import test from "node:test";
import {
  ledgerBlockHeight,
  observePreparedPayout,
  validateLocalPayoutClaim,
} from "./payout-reconciliation.js";

test("Solana Kit bigint block height crosses JSON only through a safe integer", () => {
  assert.equal(ledgerBlockHeight(469_758_340n), 469_758_340);
  assert.equal(
    ledgerBlockHeight(BigInt(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER,
  );
  for (const value of [0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1.5, Number.NaN]) {
    assert.throws(() => ledgerBlockHeight(value));
  }
});

type RpcView = {
  status: { err: unknown; confirmationStatus: string } | null;
  blockHeight: number;
};

function rpcFetch(views: Record<string, RpcView>): typeof globalThis.fetch {
  return async (input, init) => {
    assert.equal(init?.redirect, "error");
    const view = views[new URL(String(input)).origin];
    assert.ok(view);
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    return request.method === "getSignatureStatuses"
      ? Response.json({ jsonrpc: "2.0", id: request.id, result: { value: [view.status] } })
      : Response.json({ jsonrpc: "2.0", id: request.id, result: view.blockHeight });
  };
}

const base = {
  transactionSignature: "5".repeat(88),
  lastValidBlockHeight: 100,
  rpcUrls: ["https://payout-a.example", "https://payout-b.example"],
};

test("the local payout worker cannot accept one provider or reversible confirmation", async () => {
  assert.equal(await observePreparedPayout({
    ...base,
    fetchImpl: rpcFetch({
      "https://payout-a.example": {
        status: { err: null, confirmationStatus: "finalized" },
        blockHeight: 101,
      },
      "https://payout-b.example": { status: null, blockHeight: 101 },
    }),
  }), "inconclusive");
  assert.equal(await observePreparedPayout({
    ...base,
    fetchImpl: rpcFetch({
      "https://payout-a.example": {
        status: { err: null, confirmationStatus: "confirmed" },
        blockHeight: 101,
      },
      "https://payout-b.example": {
        status: { err: null, confirmationStatus: "confirmed" },
        blockHeight: 101,
      },
    }),
  }), "inconclusive");
});

test("the local payout worker requires two finalized views for either terminal outcome", async () => {
  assert.equal(await observePreparedPayout({
    ...base,
    fetchImpl: rpcFetch({
      "https://payout-a.example": {
        status: { err: null, confirmationStatus: "finalized" },
        blockHeight: 101,
      },
      "https://payout-b.example": {
        status: { err: null, confirmationStatus: "finalized" },
        blockHeight: 101,
      },
    }),
  }), "finalized");
  assert.equal(await observePreparedPayout({
    ...base,
    fetchImpl: rpcFetch({
      "https://payout-a.example": { status: null, blockHeight: 101 },
      "https://payout-b.example": { status: null, blockHeight: 102 },
    }),
  }), "absent_or_failed");
});

test("a payout RPC that never returns cannot monopolize the worker", async () => {
  const startedAt = Date.now();
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).origin === "https://payout-a.example") {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      return request.method === "getSignatureStatuses"
        ? Response.json({ jsonrpc: "2.0", id: request.id, result: { value: [null] } })
        : Response.json({ jsonrpc: "2.0", id: request.id, result: 101 });
    }
    return await new Promise<Response>((_resolve, reject) => {
      assert.ok(init?.signal);
      init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };
  assert.equal(await observePreparedPayout({
    ...base,
    fetchImpl,
    rpcTimeoutMs: 5,
  }), "inconclusive");
  assert.ok(Date.now() - startedAt < 500);
});

test("the local recovery key refuses backend economic drift before signing", () => {
  const signer = "11111111111111111111111111111111";
  const leased = {
    id: "payout_exact_local",
    escrowWallet: signer,
    recipientWallet: "SysvarRent111111111111111111111111111111111",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    amountAtomic: "1000",
    status: "leased",
  };
  assert.doesNotThrow(() => validateLocalPayoutClaim(leased, signer));
  assert.throws(
    () => validateLocalPayoutClaim({ ...leased, amountAtomic: "0x10" }, signer),
    /canonical positive integer/,
  );
  assert.throws(
    () => validateLocalPayoutClaim({ ...leased, asset: signer }, signer),
    /asset mismatch/,
  );
  assert.throws(
    () => validateLocalPayoutClaim({
      ...leased,
      status: "prepared",
      transactionSignature: "5".repeat(88),
    }, signer),
    /evidence is incomplete/,
  );
});
