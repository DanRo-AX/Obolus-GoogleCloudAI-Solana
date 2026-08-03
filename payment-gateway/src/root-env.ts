import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const rootEnvPath = resolve(repositoryRoot, ".env");
if (existsSync(rootEnvPath)) {
  // Explicit shell/deployment variables keep precedence over local file values.
  loadEnvFile(rootEnvPath);
}
