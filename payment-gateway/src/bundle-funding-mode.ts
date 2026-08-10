export const AGENT_BUNDLE_PROTOCOL = "exact-agent-bundle-v1";

export type BundleFundingMode =
  | { kind: "prepaid"; walletSession: string }
  | { kind: "agent_direct" };

export class BundleFundingModeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function bundleFundingMode(input: {
  walletSession?: string;
  agentProtocol?: string;
  topUpAtomic?: unknown;
}): BundleFundingMode {
  const walletSession = input.walletSession?.trim();
  const agentProtocol = input.agentProtocol?.trim();
  if (walletSession && agentProtocol) {
    throw new BundleFundingModeError(
      400,
      "ambiguous_funding_mode",
      "Choose either a prepaid wallet session or the agent-direct protocol, not both.",
    );
  }
  if (walletSession) return { kind: "prepaid", walletSession };
  if (!agentProtocol) {
    throw new BundleFundingModeError(
      401,
      "missing_wallet_session",
      "A verified prepaid wallet session or explicit agent-direct protocol is required.",
    );
  }
  if (agentProtocol !== AGENT_BUNDLE_PROTOCOL) {
    throw new BundleFundingModeError(
      400,
      "unsupported_agent_protocol",
      "The requested agent payment protocol is not supported.",
    );
  }
  if (input.topUpAtomic !== undefined) {
    throw new BundleFundingModeError(
      400,
      "agent_top_up_forbidden",
      "Agent-direct bundles pay the exact research budget and cannot create prepaid balance.",
    );
  }
  return { kind: "agent_direct" };
}
