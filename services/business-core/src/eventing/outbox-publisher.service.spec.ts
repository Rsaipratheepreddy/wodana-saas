import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../database/database.service";

const { redisClient } = vi.hoisted(() => ({
  redisClient: {
    connect: vi.fn(() => new Promise<void>(() => undefined)),
    destroy: vi.fn(),
    isOpen: false,
    isReady: false,
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock("redis", () => ({ createClient: vi.fn(() => redisClient) }));

import { OutboxPublisherService } from "./outbox-publisher.service";

describe("OutboxPublisherService", () => {
  it("does not block HTTP application startup while Redis reconnects", () => {
    const config = { get: vi.fn(() => "redis://unavailable.test:6379/0") } as unknown as ConfigService;
    const database = {} as DatabaseService;
    const publisher = new OutboxPublisherService(config, database);

    expect(publisher.onApplicationBootstrap()).toBeUndefined();
    expect(redisClient.connect).toHaveBeenCalledOnce();
  });
});
