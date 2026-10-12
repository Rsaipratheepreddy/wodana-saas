import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ErrorReporter } from "./common/error-reporting";
import { ErrorReportingFilter, ReportingLogger } from "./common/error-reporting.filter";
import { enhanceOpenApiFromValidation } from "./common/openapi-validation-schema";

// Off unless SENTRY_DSN is set. Production logs are one JSON object per line (LOG_FORMAT=text for plain lines).
const reporter = ErrorReporter.fromEnv("business-core");
const logger = new ReportingLogger(reporter, {
  json: process.env.NODE_ENV === "production" && process.env.LOG_FORMAT !== "text",
});

process.on("unhandledRejection", (reason) => {
  // Logged and reported, and the process keeps serving (a stray promise must not drop every request in flight).
  logger.error(reason instanceof Error ? reason : `Unhandled rejection: ${String(reason)}`, undefined, "Process");
});
process.on("uncaughtException", (error) => {
  logger.error(error, undefined, "Process");
  void reporter.flush(2_000).finally(() => process.exit(1));
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(logger);
  // nginx on the same host is the only proxy: request.ip is the client address it passes in X-Forwarded-For.
  app.set("trust proxy", "loopback");
  app.useGlobalFilters(new ErrorReportingFilter(reporter, app.get(HttpAdapterHost).httpAdapter));
  // The quotation plan sends the case's reference files (up to 12 MB, base64) to the AI gateway; every
  // other request keeps the 2 MB limit.
  app.use("/api/v1/workspaces/:workspaceId/ai/generate", json({ limit: "20mb" }));
  // Mailgun posts a received email as a form (with its HTML and headers); files come as multipart and are read by
  // the webhook's own interceptor.
  app.use("/api/v1/inbound/email", urlencoded({ extended: false, limit: "12mb", parameterLimit: 500 }));
  app.useBodyParser("json", { limit: "2mb" });
  const config = app.get(ConfigService);
  const webOrigin = config.get<string>("WEB_ORIGIN", "http://localhost:3000");
  const allowedOrigins = webOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);

  app.use(helmet());
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle("Wodana Business Core")
    .setDescription("Authoritative API for Wodana business workflows.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = enhanceOpenApiFromValidation(SwaggerModule.createDocument(app, openApiConfig));
  SwaggerModule.setup("docs", app, document);

  const port = config.get<number>("PORT", 8000);
  await app.listen(port, config.get<string>("HOST", "0.0.0.0"));
  if (reporter.enabled) new Logger("ErrorReporting").log("Errors are reported to the configured SENTRY_DSN");
}

// A failed start exits, so the container restarts instead of idling without a listener.
bootstrap().catch((error: unknown) => {
  logger.error(error instanceof Error ? error : String(error), undefined, "Bootstrap");
  void reporter.flush(2_000).finally(() => process.exit(1));
});
