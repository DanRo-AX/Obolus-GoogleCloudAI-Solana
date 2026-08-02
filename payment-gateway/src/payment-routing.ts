export type PaymentRouteIdentity =
  | { kind: "document"; queryId: string; handle: string; key: string }
  | { kind: "bundle"; quoteId: string; key: string };

/** Canonicalize the only public paths allowed to select a payment quote. */
export function paymentIdentityFromPath(path: string): PaymentRouteIdentity {
  const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
  const documentMatch = pathname.match(/^\/api\/v1\/paid-documents\/([^/]+)\/([^/]+)$/);
  if (documentMatch) {
    const queryId = decodeURIComponent(documentMatch[1]);
    const handle = decodeURIComponent(documentMatch[2]);
    if (!queryId || !handle) throw new Error("query id and document handle are required");
    return {
      kind: "document",
      queryId,
      handle,
      key: `document\u0000${queryId}\u0000${handle}`,
    };
  }
  const bundleMatch = pathname.match(/^\/api\/v1\/paid-bundles\/([^/]+)$/);
  if (bundleMatch) {
    const quoteId = decodeURIComponent(bundleMatch[1]);
    if (!quoteId) throw new Error("payment bundle quote id is required");
    return { kind: "bundle", quoteId, key: `bundle\u0000${quoteId}` };
  }
  throw new Error("invalid paid resource path");
}

export function assertPaymentQuoteUsable(expiresAt: number, now = Date.now()): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new Error("payment quote has expired; prepare a new resource");
  }
}
