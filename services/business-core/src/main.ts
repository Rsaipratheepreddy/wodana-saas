import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { enhanceOpenApiFromValidation } from "./common/openapi-validation-schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // The quotation plan sends the case's reference files (up to 12 MB, base64) to the AI gateway; every
  // other request keeps the 2 MB limit.
  app.use("/api/v1/workspaces/:workspaceId/ai/generate", json({ limit: "20mb" }));
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
}

void bootstrap();
