import { ExactSvmScheme } from "@x402/svm/exact/server";

/**
 * Builds the resource-server scheme without an RPC URL on purpose.
 *
 * Supplying an RPC URL makes the SDK embed a fresh recentBlockhash into every
 * 402 response. The signed retry then echoes the first blockhash while the
 * middleware compares it with a newly generated one and rejects an otherwise
 * valid payment as `No matching payment requirements`.
 *
 * The browser client fetches its transaction blockhash through the restricted
 * gateway RPC proxy instead, so the payment terms remain stable while the
 * signed transaction still receives a fresh lifetime.
 */
export function createStableExactSvmServerScheme(): ExactSvmScheme {
  return new ExactSvmScheme();
}
