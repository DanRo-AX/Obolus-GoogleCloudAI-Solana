export function independentRpcUrls(values: string[]): string[] {
  const byOrigin = new Map<string, string>();
  for (const value of values) {
    const parsed = secureRpcUrl(value);
    if (!byOrigin.has(parsed.origin)) byOrigin.set(parsed.origin, parsed.toString());
  }
  return [...byOrigin.values()];
}

function secureRpcUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Solana RPC endpoint must be an absolute HTTP URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Solana RPC endpoint must not embed credentials");
  }
  const loopback = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("Solana RPC endpoint must use HTTPS except on loopback");
  }
  if (parsed.hash) throw new Error("Solana RPC endpoint must not contain a fragment");
  return parsed;
}
