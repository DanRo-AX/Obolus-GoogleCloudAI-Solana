import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const output = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repositoryRoot, ".secrets/devnet-escrow.json");
const seed = randomBytes(32);
const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, `${JSON.stringify([...seed])}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
console.log(JSON.stringify({ address: signer.address, keypairPath: output }));
