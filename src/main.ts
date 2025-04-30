import * as dotenv from "dotenv";
dotenv.config();

import { NestFactory } from "@nestjs/core";
import { RandomExampleProviderModule } from "./app.module";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { LogLevel } from "@nestjs/common";

async function bootstrap() {
  let logLevels: LogLevel[] = ["log"];
  if (process.env.LOG_LEVEL == "debug") {
    logLevels = ["verbose"];
  }
  if (process.env.LOG_LEVEL == "warn") {
    logLevels = ["warn"];
  }

  const app = await NestFactory.create(RandomExampleProviderModule, { logger: logLevels });
  app.use(helmet());
  const basePath = process.env.VALUE_PROVIDER_CLIENT_BASE_PATH ?? "";

  const config = new DocumentBuilder()
    .setTitle("Simple Feed Value Provider API interface")
    .setDescription("This server is used by the FTSO protocol data provider.")
    .setVersion("1.0")
    .build();
  const options: SwaggerDocumentOptions = {
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  };
  const document = SwaggerModule.createDocument(app, config, options);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.VALUE_PROVIDER_CLIENT_PORT ? parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT) : 3101;
  console.log(`Your feed value provider for FTSO is available on PORT: ${PORT}`);
  console.log(`Open link: http://localhost:${PORT}/api-doc`);
  await app.listen(PORT, "0.0.0.0");
}

void bootstrap();
