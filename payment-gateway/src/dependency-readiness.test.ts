import assert from "node:assert/strict";
import test from "node:test";
import { createReadyDependencyGuard, requireReadyDependency } from "./dependency-readiness.js";

test("a dead or hung research worker stops new funded jobs before payment", async () => {
  await assert.rejects(
    requireReadyDependency({
      name: "research orchestrator",
      origin: "https://orchestrator.example",
      fetchImpl: async () => new Response("not ready", { status: 503 }),
    }),
    /not ready/,
  );

  const hangingFetch: typeof globalThis.fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      assert.ok(init?.signal);
      init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  await assert.rejects(
    requireReadyDependency({
      name: "research orchestrator",
      origin: "https://orchestrator.example",
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    }),
    /abort|timeout/i,
  );
});

test("a readiness response that never ends is cancelled after its status is known", async () => {
  let cancelled = false;
  await requireReadyDependency({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("{"));
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200 }),
  });
  assert.equal(cancelled, true);
});

test("a bodyless readiness response does not require a cancellation handle", async () => {
  await requireReadyDependency({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("accept"), "application/json");
      return { ok: true, status: 200, body: null } as Response;
    },
  });
});

test("readiness cache TTLs reject every value outside the bounded integer contract", () => {
  for (const [key, value] of [
    ["successTtlMs", -1],
    ["successTtlMs", 1.5],
    ["successTtlMs", 5_001],
    ["failureTtlMs", -1],
    ["failureTtlMs", 1.5],
    ["failureTtlMs", 5_001],
  ] as const) {
    assert.throws(
      () => createReadyDependencyGuard({
        name: "research orchestrator",
        origin: "https://orchestrator.example",
        [key]: value,
      }),
      /cache TTLs must be between 0 and 5000ms/,
    );
  }

  assert.doesNotThrow(() => createReadyDependencyGuard({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    successTtlMs: 0,
    failureTtlMs: 5_000,
  }));
  assert.doesNotThrow(() => createReadyDependencyGuard({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    successTtlMs: 5_000,
    failureTtlMs: 0,
  }));
});

test("the default monotonic clock keeps a successful dependency probe cached", async () => {
  let calls = 0;
  const guard = createReadyDependencyGuard({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });

  await guard();
  await guard();
  assert.equal(calls, 1);
});

test("concurrent public readiness traffic produces one bounded upstream probe", async () => {
  let calls = 0;
  let now = 1_000;
  const guard = createReadyDependencyGuard({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    now: () => now,
    successTtlMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      await Promise.resolve();
      return new Response("{}", { status: 200 });
    },
  });
  await Promise.all(Array.from({ length: 100 }, () => guard()));
  assert.equal(calls, 1);
  await guard();
  assert.equal(calls, 1);
  now += 1_000;
  await guard();
  assert.equal(calls, 2);
});

test("an orchestrator outage is briefly negative-cached instead of becoming a probe storm", async () => {
  let calls = 0;
  let now = 1_000;
  const guard = createReadyDependencyGuard({
    name: "research orchestrator",
    origin: "https://orchestrator.example",
    now: () => now,
    failureTtlMs: 250,
    fetchImpl: async () => {
      calls += 1;
      return new Response("not ready", { status: 503 });
    },
  });
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => guard()));
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
  await assert.rejects(guard, /not ready/);
  assert.equal(calls, 1);
  now += 250;
  await assert.rejects(guard, /not ready/);
  assert.equal(calls, 2);
});
