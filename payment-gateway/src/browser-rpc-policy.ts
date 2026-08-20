const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: unknown;
  method: string;
  params?: unknown[];
};

/**
 * Browser RPC is deliberately a tiny read-only surface. In addition to the
 * two calls required to construct a Phantom refill, the UI may read the
 * connected owner's balance for one configured mint. It cannot scan arbitrary
 * tokens, submit transactions, or read another mint through this proxy.
 */
export function isAllowedBrowserRpcRequest(
  body: unknown,
  allowedMint: string,
): body is JsonRpcRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as Record<string, unknown>;
  if (
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string" ||
    (request.params !== undefined && !Array.isArray(request.params))
  ) {
    return false;
  }

  const params = (request.params ?? []) as unknown[];
  if (request.method === "getLatestBlockhash") {
    return params.length <= 1 && isCommitmentConfig(params[0], false);
  }
  if (request.method === "getAccountInfo") {
    return (
      params.length >= 1 &&
      params.length <= 2 &&
      isPublicKey(params[0]) &&
      isAccountInfoConfig(params[1])
    );
  }
  if (request.method === "getTokenAccountsByOwner") {
    return isTokenBalanceRequest(params, allowedMint);
  }
  return false;
}

function isTokenBalanceRequest(params: unknown[], allowedMint: string): boolean {
  if (params.length !== 3 || !isPublicKey(params[0])) return false;
  const filter = params[1];
  const config = params[2];
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;

  const filterRecord = filter as Record<string, unknown>;
  const configRecord = config as Record<string, unknown>;
  return (
    Object.keys(filterRecord).length === 1 &&
    filterRecord.mint === allowedMint &&
    Object.keys(configRecord).every((key) => ["encoding", "commitment"].includes(key)) &&
    configRecord.encoding === "jsonParsed" &&
    (configRecord.commitment === undefined || configRecord.commitment === "confirmed")
  );
}

function isAccountInfoConfig(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    Object.keys(config).every((key) => ["encoding", "commitment"].includes(key)) &&
    (config.encoding === undefined || config.encoding === "base64") &&
    (config.commitment === undefined || ["confirmed", "finalized"].includes(String(config.commitment)))
  );
}

function isCommitmentConfig(value: unknown, required: boolean): boolean {
  if (value === undefined) return !required;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    Object.keys(config).every((key) => key === "commitment") &&
    (config.commitment === undefined || ["confirmed", "finalized"].includes(String(config.commitment)))
  );
}

function isPublicKey(value: unknown): value is string {
  return typeof value === "string" && BASE58_ADDRESS.test(value);
}
