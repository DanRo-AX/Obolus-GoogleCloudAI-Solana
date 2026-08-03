# OPENSHELF Human Data API

Use OPENSHELF when a question needs current, local, first-person human evidence
that a general model cannot reliably know. Search is free. Opening a private
human document is paid in USDC through Pay.sh, and the verified contributor
wallet receives the payment in the same MPP charge.

## Safe agent workflow

1. `POST /api/v1/questions/resolve` with a question, desired document count,
   optional KRW budget, and demographic filters. Save both `queryId` and the
   query-scoped `paymentAccessToken` from the response.
2. Select only handles returned in `matches`. Never infer or enumerate handles.
3. For each handle, first call the free
   `GET /api/v1/questions/{queryId}/pay-sh-documents/{handle}` with
   `x-openshelf-query-token`. A 200 response means it was already delivered;
   use it and do not pay again. A 404 means it is still unopened.
4. Call the free
   `GET /api/v1/questions/{queryId}/pay-sh-resources/{handle}` with the same
   header. If `status` is `delivered`, use `recoveryPath`. Otherwise check the
   recipient, atomic amount, price, network, asset, and expiry.
5. Use `pay curl` on the returned `resourcePath`, preserving
   `x-openshelf-query-token`. Pay.sh handles the 402/MPP exchange and retries.
6. Synthesize only from returned citations and retain every citation handle.

Example:

```bash
pay curl -s \
  -H "x-openshelf-query-token: $QUERY_TOKEN" \
  "$OPENSHELF_PAY_URL$RESOURCE_PATH"
```

Prices supported by the hackathon gateway are fixed KRW bands: 5, 10, 15, 25,
100, 300, 500, 700, 800, and 1,000 at 1 USDC = 1,350 KRW. The gateway charges the
ceiling in six-decimal USDC atomic units. All but one atomic unit is split
directly to the verified database owner; one atomic unit remains with the
primary gateway recipient because Pay.sh requires a positive primary share.

Do not retry a paid URL blindly after a timeout. Always use the free recovery
route first. Do not use passages from one `queryId` in another query: the query
token is a scoped, 24-hour capability rather than a general database key.
