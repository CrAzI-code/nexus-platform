import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');
const apiEnvPath = fileURLToPath(new URL('../.env', import.meta.url));
const envFile = dotenv.config({
  path: apiEnvPath,
  override: process.env.NODE_ENV !== 'production',
});

const clerkSecret = process.env.CLERK_SECRET_KEY;
const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES
  ?.split(',')
  .map((party) => party.trim())
  .filter(Boolean);

logger.log(
  JSON.stringify({
    event: 'clerk_configuration_loaded',
    apiEnvFileLoaded: Boolean(envFile.parsed),
    apiSecretConfigured: Boolean(clerkSecret?.trim()),
    apiSecretHasExpectedPrefix: /^sk_(test|live)_/.test(clerkSecret ?? ''),
    apiSecretHasNoSurroundingWhitespace:
      clerkSecret === clerkSecret?.trim(),
    apiSecretMatchesApiEnvFile:
      clerkSecret === envFile.parsed?.CLERK_SECRET_KEY,
    authorizedPartiesConfigured: Boolean(authorizedParties?.length),
    frontendOriginAllowed:
      authorizedParties?.includes('http://localhost:3000') ?? false,
  }),
);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: 'http://localhost:3000',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
  }
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
