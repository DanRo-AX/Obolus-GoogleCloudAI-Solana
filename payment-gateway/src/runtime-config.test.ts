import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanEnv,
  integerEnv,
  managedEnvironment,
  managedRuntimeEnvironment,
  researchOrchestratorReadinessRequired,
} from "./runtime-config.js";

test("timer configuration cannot overflow Node into a one-millisecond hot loop", () => {
  assert.equal(integerEnv("POLL", 30_000, 5_000, 300_000, {}), 30_000);
  assert.equal(integerEnv("POLL", 30_000, 5_000, 300_000, { POLL: " 5000 " }), 5_000);
  assert.throws(
    () => integerEnv("POLL", 30_000, 5_000, 300_000, { POLL: "2147483648" }),
    /between 5000 and 300000/,
  );
  assert.throws(
    () => integerEnv("POLL", 30_000, 5_000, 300_000, { POLL: "30000junk" }),
    /base-10 integer/,
  );
});

test("deployment-mode and mainnet flag typos fail closed", () => {
  assert.equal(managedEnvironment("staging"), true);
  assert.equal(managedEnvironment("development"), false);
  assert.throws(() => managedEnvironment("prodution"), /must be production/);
  assert.equal(booleanEnv("MAINNET", false, { MAINNET: "true" }), true);
  assert.throws(() => booleanEnv("MAINNET", false, { MAINNET: "ture" }), /explicit boolean/);
});

test("a Cloud Run process cannot opt out of managed safety with a development label", () => {
  assert.equal(managedRuntimeEnvironment("development", { K_SERVICE: "openshelf-gateway" }), true);
  assert.equal(managedRuntimeEnvironment("test", { K_REVISION: "revision-1" }), true);
  assert.equal(managedRuntimeEnvironment("local", { CLOUD_RUN_JOB: "rollback-sweep" }), true);
  assert.equal(managedRuntimeEnvironment("local", {}), false);
});

test("only an unmanaged direct-payment runtime may omit global research readiness", () => {
  assert.equal(researchOrchestratorReadinessRequired(true, false), true);
  assert.equal(researchOrchestratorReadinessRequired(false, false), false);
  assert.equal(researchOrchestratorReadinessRequired(true, true), true);
  assert.throws(
    () => researchOrchestratorReadinessRequired(false, true),
    /cannot be disabled in a managed environment/,
  );
});
