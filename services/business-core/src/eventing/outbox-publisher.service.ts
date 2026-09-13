import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { DatabaseService } from "../database/database.service";
import { canonicalEventEnvelope, PublishableOutboxEvent } from "./event-envelope";

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly client;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private connecting?: Promise<void>;
  private stopping = false;

  constructor(config: ConfigService, private readonly database: DatabaseService) {
    const url = config.get<string>("REDIS_URL");
    this.client = url ? createClient({ url, socket: { reconnectStrategy: (retries) => Math.min(1000 * 2 ** retries, 30_000) } }) : null;
    this.client?.on("error", (error) => this.logger.error(`Redis publisher error: ${error instanceof Error ? error.message : String(error)}`));
  }

  onApplicationBootstrap(): void {
    if (!this.client) {
      this.logger.warn("REDIS_URL is not configured; transactional events remain safely queued in PostgreSQL");
      return;
    }
    // Redis is an asynchronous delivery accelerator; PostgreSQL remains the
    // durable outbox. Never hold the HTTP server startup hostage while Redis
    // is unavailable—the client can reconnect in the background.
    this.connecting = this.client.connect()
      .then(() => {
        if (this.stopping) return;
        this.timer = setInterval(() => this.schedule(), 500);
        this.timer.unref();
        this.schedule();
      })
      .catch((error) => {
        this.logger.error(`Unable to connect outbox publisher: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => { this.connecting = undefined; });
  }

  private schedule(): void {
    if (this.stopping || this.running || !this.client?.isReady) return;
    this.running = this.publishBatch().finally(() => { this.running = undefined; });
  }

  private async publishBatch(): Promise<void> {
    const leaseToken = randomUUID();
    let events: PublishableOutboxEvent[] = [];
    try {
      const result = await this.database.query<PublishableOutboxEvent>(`SELECT * FROM claim_outbox_events($1,$2,$3)`, [50, leaseToken, 60]);
      events = result.rows;
    } catch (error) {
      this.logger.error(`Unable to claim outbox events: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const event of events) {
      try {
        const envelope = canonicalEventEnvelope(event);
        await this.client!.xAdd("wodana:domain-events", "*", {
          eventId: event.id,
          eventType: event.event_type,
          workspaceId: event.workspace_id,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
          payload: JSON.stringify(envelope),
          attempt: String(event.attempts),
        });
        await this.database.query(`SELECT complete_outbox_event($1,$2)`, [event.id, leaseToken]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.database.query(`SELECT fail_outbox_event($1,$2,$3)`, [event.id, leaseToken, message]).catch(() => undefined);
        this.logger.error(`Event ${event.id} publish failed: ${message}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
    if (this.client?.isReady) await this.client.quit();
    else if (this.client?.isOpen) this.client.destroy();
  }
}
