import "reflect-metadata";
import { Module, UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InboundEmailWebhookController } from "./crm-inbound-email.controller";
import { CrmInboundEmailService } from "./crm-inbound-email.service";

const receive = vi.fn();

class WebhookTestModule {}
Module({ controllers: [InboundEmailWebhookController], providers: [{ provide: CrmInboundEmailService, useValue: { receiveMailgun: receive } }] })(WebhookTestModule);

describe("Mailgun inbound webhook route", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await NestFactory.create(WebhookTestModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    // The same pipe as production: Mailgun's free-form fields must pass it untouched.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(() => app.close());

  it("hands Mailgun's multipart form, with its files, to the service", async () => {
    receive.mockResolvedValueOnce({ status: "stored", conversationId: "c1" });
    const response = await request(app.getHttpServer()).post("/api/v1/inbound/email/mailgun")
      .field("recipient", "plm-abcdefghij@in.wodana.ai").field("from", "Noura <noura@example.com>").field("subject", "Villa")
      .field("body-plain", "Hello").field("message-headers", JSON.stringify([["Message-Id", "<n1@example.com>"]]))
      .field("timestamp", "1800000000").field("token", "t".repeat(50)).field("signature", "f".repeat(64))
      .attach("attachment-1", Buffer.from("%PDF-1.4"), { filename: "plan.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "stored", conversationId: "c1" });
    const [body, files] = receive.mock.calls[0];
    expect(body).toMatchObject({ recipient: "plm-abcdefghij@in.wodana.ai", subject: "Villa", "body-plain": "Hello", token: "t".repeat(50) });
    expect(files.map((file: { fieldname: string; originalname: string; buffer: Buffer }) => [file.fieldname, file.originalname, file.buffer.toString()])).toEqual([["attachment-1", "plan.pdf", "%PDF-1.4"]]);
  });

  it("accepts the url-encoded form and answers 401 when the service refuses the signature", async () => {
    receive.mockRejectedValueOnce(new UnauthorizedException("Invalid webhook signature"));
    const response = await request(app.getHttpServer()).post("/api/v1/inbound/email/mailgun").type("form").send({ recipient: "x@in.wodana.ai", signature: "bad" });
    expect(response.status).toBe(401);
    expect(receive.mock.calls.at(-1)?.[0]).toMatchObject({ recipient: "x@in.wodana.ai", signature: "bad" });
  });
});
