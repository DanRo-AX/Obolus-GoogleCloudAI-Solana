import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const resourceUrl = required("PAID_RESOURCE_URL");
const privateKey = required("SVM_PRIVATE_KEY");
const network = (process.env.X402_NETWORK?.trim() ||
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as Network;
const maxPaymentAtomic = BigInt(process.env.MAX_PAYMENT_ATOMIC?.trim() || "1000000");
const privateKeyBytes = privateKey.startsWith("[")
  ? Uint8Array.from(JSON.parse(privateKey) as number[])
  : base58.decode(privateKey);

const signer = await createKeyPairSignerFromBytes(privateKeyBytes);
const client = new x402Client().register(network, new ExactSvmScheme(signer));
client.registerPolicy((_version, requirements) =>
  requirements.filter(
    (requirement) =>
      requirement.network === network && BigInt(requirement.amount) <= maxPaymentAtomic,
  ),
);

const paidFetch = wrapFetchWithPayment(fetch, client);
const response = await paidFetch(resourceUrl, {
  method: "GET",
  headers: { accept: "application/json" },
});
const body = await response.text();
if (!response.ok) throw new Error(`paid request failed (${response.status}): ${body}`);

const header = response.headers.get("PAYMENT-RESPONSE");
const receipt = header ? decodePaymentResponseHeader(header) : null;
console.log(JSON.stringify({ body: JSON.parse(body), receipt }, null, 2));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
