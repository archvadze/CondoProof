import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (process.env.DEMO_GOVERNANCE_ENABLED === "true") {
    await app.listen(process.env.PORT ?? 3001, "127.0.0.1");
  } else {
    await app.listen(process.env.PORT ?? 3001);
  }
}

await bootstrap();
