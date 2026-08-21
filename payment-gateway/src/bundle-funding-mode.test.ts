import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_BUNDLE_PROTOCOL,
  BundleFundingModeError,
  bundleFundingMode,
} from "./bundle-funding-mode.js";

test("prepaid and one-shot agent funding are explicit, mutually exclusive contracts", () => {
  assert.deepEqual(
    bundleFundingMode({ walletSession: "  wallet-session  " }),
    { kind: "prepaid", walletSession: "wallet-session" },
  );
  assert.deepEqual(
    bundleFundingMode({ agentProtocol: `  ${AGENT_BUNDLE_PROTOCOL}  ` }),
    { kind: "agent_direct" },
  );

  const cases = [
    {
      input: {},
      status: 401,
      code: "missing_wallet_session",
    },
    {
      input: { agentProtocol: "legacy-agent-bundle" },
      status: 400,
      code: "unsupported_agent_protocol",
    },
    {
      input: { walletSession: "wallet", agentProtocol: AGENT_BUNDLE_PROTOCOL },
      status: 400,
      code: "ambiguous_funding_mode",
    },
    {
      input: { walletSession: "wallet", topUpAtomic: "5000000" },
      status: 400,
      code: "automatic_top_up_forbidden",
    },
    {
      input: { agentProtocol: AGENT_BUNDLE_PROTOCOL, topUpAtomic: "1" },
      status: 400,
      code: "agent_top_up_forbidden",
    },
  ] as const;
  for (const expected of cases) {
    assert.throws(
      () => bundleFundingMode(expected.input),
      (error: unknown) =>
        error instanceof BundleFundingModeError
        && error.status === expected.status
        && error.code === expected.code,
    );
  }
});
