import { CloudTasksClient } from "@google-cloud/tasks";
import { secureServiceOrigin } from "./url-policy.js";

export type DurableSettlement = {
  // "topup" is admitted for type-parity with ReconciliationAttempt: the shared
  // chain-reconciler helpers construct DurableSettlement literals from an
  // attempt's kind. Standalone top-ups never enter this durable outbox — they
  // credit through the idempotent internal deposit route — so no topup task is
  // ever enqueued here.
  settlementKind: "document" | "bundle" | "open_call" | "topup";
  quoteId: string;
  attemptId: string;
  transactionSignature: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  network: string;
  rawResponse: unknown;
};

type QueueConfiguration = {
  projectId: string;
  location: string;
  queue: string;
  targetBaseUrl: string;
  internalToken: string;
};

export class DurableSettlementQueue {
  private readonly client: CloudTasksClient;
  private readonly parent: string;

  private constructor(private readonly configuration: QueueConfiguration) {
    this.client = new CloudTasksClient();
    this.parent = this.client.queuePath(
      configuration.projectId,
      configuration.location,
      configuration.queue,
    );
  }

  static fromEnvironment(production: boolean, internalToken: string): DurableSettlementQueue | null {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = process.env.OPENSHELF_SETTLEMENT_QUEUE_LOCATION?.trim();
    const queue = process.env.OPENSHELF_SETTLEMENT_QUEUE?.trim();
    const rawTargetBaseUrl = process.env.OPENSHELF_SETTLEMENT_TARGET_URL?.trim();
    const targetBaseUrl = rawTargetBaseUrl
      ? secureServiceOrigin("OPENSHELF_SETTLEMENT_TARGET_URL", rawTargetBaseUrl)
      : undefined;
    const complete = projectId && location && queue && targetBaseUrl;

    if (!complete) {
      if (production) {
        throw new Error(
          "Cloud Tasks settlement queue configuration is required in production " +
            "(GOOGLE_CLOUD_PROJECT, OPENSHELF_SETTLEMENT_QUEUE_LOCATION, " +
            "OPENSHELF_SETTLEMENT_QUEUE, OPENSHELF_SETTLEMENT_TARGET_URL)",
        );
      }
      return null;
    }
    if (location !== "asia-northeast3") {
      throw new Error("OPENSHELF_SETTLEMENT_QUEUE_LOCATION must be asia-northeast3");
    }
    if (!targetBaseUrl.startsWith("https://")) {
      throw new Error("OPENSHELF_SETTLEMENT_TARGET_URL must use HTTPS");
    }
    return new DurableSettlementQueue({
      projectId,
      location,
      queue,
      targetBaseUrl,
      internalToken,
    });
  }

  async enqueue(settlement: DurableSettlement): Promise<void> {
    const endpoint = settlement.settlementKind === "bundle"
      ? "/internal/v1/bundle-chain-settlements"
      : settlement.settlementKind === "open_call"
        ? "/internal/v1/open-call-chain-settlements"
        : "/internal/v1/chain-settlements";
    const taskId = `settlement-${settlement.transactionSignature}`;
    const name = this.client.taskPath(
      this.configuration.projectId,
      this.configuration.location,
      this.configuration.queue,
      taskId,
    );

    try {
      await this.client.createTask({
        parent: this.parent,
        task: {
          name,
          httpRequest: {
            httpMethod: "POST",
            url: `${this.configuration.targetBaseUrl}${endpoint}`,
            headers: {
              "content-type": "application/json",
              "x-openshelf-internal-token": this.configuration.internalToken,
            },
            body: Buffer.from(JSON.stringify(settlement)),
          },
          // Dispatch immediately. The synchronous write below and this task
          // may race, but Rust's settlement registry makes either order safe
          // and removes a deliberate window where another instance could
          // still observe the quote as payable.
          dispatchDeadline: { seconds: 30 },
        },
      });
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (code === 6 || code === "6" || code === "ALREADY_EXISTS") return;
      throw error;
    }
  }
}
