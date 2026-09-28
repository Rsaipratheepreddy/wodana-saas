import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable, Subject, filter, map } from "rxjs";
import { createClient, type RedisClientType } from "redis";
import { liveScopes } from "./live-scopes";

export const DOMAIN_EVENT_STREAM = "wodana:domain-events";
export type LiveEvent = { workspaceId: string; scopes: string[] };

/**
 * One reader per API process tails the domain-event stream (the outbox, published to Redis) from "now" and
 * fans each event out, as scopes, to the workspace's open event streams. Without Redis nothing is sent and
 * screens keep polling.
 */
@Injectable()
export class LiveEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly events = new Subject<LiveEvent>();
  private reader: RedisClientType | null = null;
  private listeners = 0;
  private stopping = false;
  private loop: Promise<void> | null = null;

  constructor(@Optional() private readonly config?: ConfigService) {}

  /** A workspace's events while subscribed; the reader starts with the first subscriber. */
  stream(workspaceId: string): Observable<LiveEvent> {
    return new Observable<LiveEvent>((subscriber) => {
      this.listeners += 1;
      this.start();
      const subscription = this.events.pipe(filter((event) => event.workspaceId === workspaceId)).subscribe(subscriber);
      return () => { subscription.unsubscribe(); this.listeners -= 1; };
    });
  }

  /** Feeds one stream entry (the reader, and tests). */
  publish(fields: Record<string, string>) {
    if (!fields.workspaceId) return;
    this.events.next({ workspaceId: fields.workspaceId, scopes: liveScopes({ eventType: fields.eventType ?? "", aggregateType: fields.aggregateType ?? "", aggregateId: fields.aggregateId ?? "", payload: fields.payload }) });
  }

  get connected() { return Boolean(this.reader?.isReady); }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.reader?.isOpen) this.reader.destroy();
    await this.loop?.catch(() => undefined);
    this.events.complete();
  }

  private start() {
    if (this.loop || this.stopping) return;
    const url = this.config?.get<string>("REDIS_URL");
    if (!url) return;
    this.loop = this.read(url).finally(() => { this.loop = null; });
  }

  private async read(url: string) {
    let lastId = "$";
    while (!this.stopping && this.listeners > 0) {
      try {
        if (!this.reader?.isReady) {
          const reader = createClient({ url, socket: { connectTimeout: 3_000, reconnectStrategy: false } });
          reader.on("error", () => undefined);
          await reader.connect();
          this.reader = reader as RedisClientType;
        }
        const batches = await this.reader.xRead({ key: DOMAIN_EVENT_STREAM, id: lastId }, { BLOCK: 15_000, COUNT: 100 });
        for (const batch of (batches ?? []) as Array<{ messages: Array<{ id: string; message: Record<string, string> }> }>) {
          for (const entry of batch.messages) { lastId = entry.id; this.publish(entry.message); }
        }
      } catch (error) {
        if (this.stopping) return;
        this.logger.warn(`Live events paused: ${error instanceof Error ? error.message : "Redis unavailable"}`);
        if (this.reader?.isOpen) this.reader.destroy();
        this.reader = null;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    if (this.reader?.isOpen) this.reader.destroy();
    this.reader = null;
  }
}

export const toMessage = map((event: LiveEvent) => ({ type: "change", data: { scopes: event.scopes } }));
