export type TokenBalance = {
  owner?: string;
  mint?: string;
  uiTokenAmount?: { amount?: string };
};

export type TokenBalanceMeta = {
  err?: unknown;
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
};

export function assertExactTokenTransfer(
  meta: TokenBalanceMeta,
  expected: { payer: string; recipient: string; mint: string; amountAtomic: string },
): void {
  if (meta.err) throw new Error("settlement transaction failed on-chain");
  const payerDelta = tokenDelta(meta, expected.payer, expected.mint);
  const recipientDelta = tokenDelta(meta, expected.recipient, expected.mint);
  const amount = BigInt(expected.amountAtomic);
  if (payerDelta !== -amount || recipientDelta !== amount) {
    throw new Error(
      `confirmed transaction does not match quote transfer: payer=${payerDelta} recipient=${recipientDelta}`,
    );
  }
}

export function tokenDelta(meta: TokenBalanceMeta, owner: string, mint: string): bigint {
  const total = (balances: TokenBalance[] | undefined) =>
    (balances ?? [])
      .filter((balance) => balance.owner === owner && balance.mint === mint)
      .reduce(
        (sum, balance) => sum + BigInt(balance.uiTokenAmount?.amount ?? "0"),
        0n,
      );
  return total(meta.postTokenBalances) - total(meta.preTokenBalances);
}
