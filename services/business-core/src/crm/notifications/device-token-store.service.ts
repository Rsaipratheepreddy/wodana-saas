import { Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

@Injectable()
export class DeviceTokenStoreService implements OnModuleDestroy {
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType> | null = null;

  constructor(private readonly config: ConfigService) {}

  async put(workspaceId: string, userId: string, token: string) {
    const reference = `redis:push:${workspaceId}:${userId}:${randomUUID()}`;
    await (await this.redis()).set(reference, token);
    return reference;
  }

  async delete(reference: string | null | undefined) {
    if (!reference) return;
    try { await (await this.redis()).del(reference); } catch { /* revocation remains authoritative in PostgreSQL */ }
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit().catch(() => this.client?.destroy());
    this.client = null;
  }

  private async redis() {
    if (this.client?.isOpen) return this.client;
    if (this.connecting) return this.connecting;
    const url = this.config.get<string>("REDIS_URL");
    if (!url) throw new ServiceUnavailableException("Push registration is unavailable because secure token storage is not configured");
    const client = createClient({ url, socket: { connectTimeout: 3_000, reconnectStrategy: false } });
    client.on("error", () => undefined);
    this.connecting = client.connect().then(() => {
      this.client = client as RedisClientType;
      return this.client;
    }).catch((error) => {
      client.destroy();
      throw new ServiceUnavailableException("Push registration is temporarily unavailable", { cause: error });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
}
