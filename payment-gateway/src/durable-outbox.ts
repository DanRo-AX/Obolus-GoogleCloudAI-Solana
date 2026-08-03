import { CloudTasksClient } from "@google-cloud/tasks";

export type DurableSettlement = {
  settlementKind?: "document" | "bundle" | "open_call";
  quoteId: string;
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
    const targetBaseUrl = process.env.OPENSHELF_SETTLEMENT_TARGET_URL?.trim()?.replace(/\/$/, "");
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
          // Give the synchronous ledger write a short head start. The queued
          // delivery is still required and safely replays the idempotent write.
          scheduleTime: {
            seconds: Math.floor(Date.now() / 1_000) + 3,
          },
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
