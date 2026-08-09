export function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (
    !Number.isSafeInteger(fallback)
    || fallback < minimum
    || fallback > maximum
    || !Number.isSafeInteger(minimum)
    || !Number.isSafeInteger(maximum)
    || minimum > maximum
  ) {
    throw new Error(`invalid integer configuration contract for ${name}`);
  }
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a base-10 integer between ${minimum} and ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function booleanEnv(
  name: string,
  fallback: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be an explicit boolean`);
}

export function managedEnvironment(value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "production":
    case "prod":
    case "staging":
    case "stage":
      return true;
    case "development":
    case "dev":
    case "local":
    case "test":
      return false;
    default:
      throw new Error(
        "OPENSHELF_ENV/NODE_ENV must be production, prod, staging, stage, development, dev, local, or test",
      );
  }
}

export function managedRuntimeEnvironment(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = managedEnvironment(value)
  const cloudRun = [
    "K_SERVICE",
    "K_REVISION",
    "K_CONFIGURATION",
    "CLOUD_RUN_JOB",
    "CLOUD_RUN_EXECUTION",
  ].some(
    (name) => Boolean(environment[name]?.trim()),
  )
  return configured || cloudRun
}

export function researchOrchestratorReadinessRequired(
  configured: boolean,
  managed: boolean,
): boolean {
  if (managed && !configured) {
    throw new Error(
      "OPENSHELF_REQUIRE_RESEARCH_ORCHESTRATOR cannot be disabled in a managed environment",
    )
  }
  return configured
}
