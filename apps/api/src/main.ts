import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { resolveListenHost } from "./listen-host.js";

async function bootstrap() {
  const host = resolveListenHost(
    process.env.CONDOPROOF_API_BIND_HOST,
    process.env.DEMO_GOVERNANCE_ENABLED === "true",
  );
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001, host);
}

await bootstrap();
