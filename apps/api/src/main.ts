import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { getWebCorsOrigin } from './cors.js';

const logger = new Logger('Bootstrap');
const apiEnvPath = fileURLToPath(new URL('../.env', import.meta.url));
const inheritedBrevoApiKey = process.env.BREVO_API_KEY;
const dotenvOverride = process.env.NODE_ENV !== 'production';
const envFile = dotenv.config({
  path: apiEnvPath,
  override: dotenvOverride,
});

const runtimeBrevoApiKey = process.env.BREVO_API_KEY;
const envFileBrevoApiKey = envFile.parsed?.BREVO_API_KEY;
const brevoApiKeySource = dotenvOverride
  ? envFileBrevoApiKey
    ? 'apps/api/.env'
    : inheritedBrevoApiKey
      ? 'process environment'
      : 'missing'
  : inheritedBrevoApiKey
    ? 'process environment'
    : envFileBrevoApiKey
      ? 'apps/api/.env'
      : 'missing';
const clerkSecret = process.env.CLERK_SECRET_KEY;
const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES
  ?.split(',')
  .map((party) => party.trim())
  .filter(Boolean);

logger.log(
  JSON.stringify({
    event: 'clerk_configuration_loaded',
    apiEnvFileLoaded: Boolean(envFile.parsed),
    apiEnvFile: 'apps/api/.env',
    dotenvOverrideEnabled: dotenvOverride,
    apiSecretConfigured: Boolean(clerkSecret?.trim()),
    apiSecretHasExpectedPrefix: /^sk_(test|live)_/.test(clerkSecret ?? ''),
    apiSecretHasNoSurroundingWhitespace:
      clerkSecret === clerkSecret?.trim(),
    apiSecretMatchesApiEnvFile:
      clerkSecret === envFile.parsed?.CLERK_SECRET_KEY,
    authorizedPartiesConfigured: Boolean(authorizedParties?.length),
    frontendOriginAllowed:
      authorizedParties?.includes('http://localhost:3000') ?? false,
    brevoApiKeyConfigured: Boolean(process.env.BREVO_API_KEY?.trim()),
    brevoSenderEmailConfigured: Boolean(
      process.env.BREVO_SENDER_EMAIL?.trim(),
    ),
    brevoSenderNameConfigured: Boolean(
      process.env.BREVO_SENDER_NAME?.trim(),
    ),
    brevoApiKeySource,
    brevoApiKeyHasExpectedV3Format:
      /^xkeysib-[A-Za-z0-9_-]+$/u.test(runtimeBrevoApiKey?.trim() ?? ''),
    brevoApiKeyHasSurroundingWhitespace: Boolean(
      runtimeBrevoApiKey && runtimeBrevoApiKey !== runtimeBrevoApiKey.trim(),
    ),
    brevoApiKeyMatchesApiEnvFile: Boolean(
      runtimeBrevoApiKey &&
        envFileBrevoApiKey &&
        runtimeBrevoApiKey === envFileBrevoApiKey,
    ),
    brevoApiKeyLoadedFromApiEnvFile: Boolean(
      process.env.BREVO_API_KEY &&
        envFile.parsed?.BREVO_API_KEY &&
        process.env.BREVO_API_KEY === envFile.parsed.BREVO_API_KEY,
    ),
    brevoSenderEmailLoadedFromApiEnvFile: Boolean(
      process.env.BREVO_SENDER_EMAIL &&
        envFile.parsed?.BREVO_SENDER_EMAIL &&
        process.env.BREVO_SENDER_EMAIL === envFile.parsed.BREVO_SENDER_EMAIL,
    ),
    brevoSenderNameLoadedFromApiEnvFile: Boolean(
      process.env.BREVO_SENDER_NAME &&
        envFile.parsed?.BREVO_SENDER_NAME &&
        process.env.BREVO_SENDER_NAME === envFile.parsed.BREVO_SENDER_NAME,
    ),
  }),
);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const webOrigin = getWebCorsOrigin(process.env);
  if (webOrigin) {
    app.enableCors({
      origin: webOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
  }
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
