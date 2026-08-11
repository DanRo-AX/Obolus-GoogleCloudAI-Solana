export default {
  mutate: [
    "src/bundle-funding-mode.ts",
    "src/dependency-readiness.ts",
    "src/reconciler-readiness.ts",
    "src/rpc-policy.ts",
    "src/settlement-durability.ts",
  ],
  testRunner: "command",
  commandRunner: {
    command: [
      "tsx --test",
      "src/bundle-funding-mode.test.ts",
      "src/dependency-readiness.test.ts",
      "src/reconciler-readiness.test.ts",
      "src/rpc-policy.test.ts",
      "src/settlement-durability.test.ts",
    ].join(" "),
  },
  coverageAnalysis: "off",
  mutator: {
    excludedMutations: ["StringLiteral"],
  },
  reporters: process.env.CI
    ? ["clear-text", "json"]
    : ["clear-text", "progress"],
  concurrency: process.env.CI ? 2 : 1,
  timeoutMS: 10_000,
  cleanTempDir: "always",
  thresholds: {
    high: 100,
    low: 95,
    break: 100,
  },
};
