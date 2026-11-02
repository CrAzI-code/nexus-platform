import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const apiEnvPath = fileURLToPath(new URL('../.env', import.meta.url));
const envResult = dotenv.config({
  path: apiEnvPath,
  override: true,
  quiet: true,
});

function printResult(httpStatus, responseCode, responseMessage) {
  console.log(
    JSON.stringify({
      httpStatus,
      responseCode,
      responseMessage,
    }),
  );
}

function sanitizeMessage(message, apiKey) {
  let sanitized = message
    .replace(/https?:\/\/\S+/giu, '[redacted-url]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted-email]')
    .replace(/\b[a-f0-9]{64}\b/giu, '[redacted-token]');
  if (apiKey) sanitized = sanitized.split(apiKey).join('[redacted]');
  return sanitized.replace(/[\r\n\t]+/gu, ' ').slice(0, 240);
}

if (envResult.error) {
  printResult(
    null,
    'configuration_error',
    'The API environment file could not be loaded.',
  );
  process.exitCode = 1;
} else {
  const apiKey = process.env.BREVO_API_KEY?.trim();

  if (!apiKey) {
    printResult(
      null,
      'configuration_error',
      'BREVO_API_KEY is missing from the API environment configuration.',
    );
    process.exitCode = 1;
  } else {
    try {
      const response = await fetch('https://api.brevo.com/v3/account', {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });

      let responseCode = null;
      let responseMessage = null;
      try {
        const body = await response.json();
        if (typeof body === 'object' && body !== null) {
          if (typeof body.code === 'string' || typeof body.code === 'number') {
            responseCode = body.code;
          }
          if (typeof body.message === 'string') {
            responseMessage = sanitizeMessage(body.message, apiKey);
          }
        }
      } catch {
        responseMessage = 'Brevo returned a non-JSON response.';
      }

      printResult(response.status, responseCode, responseMessage);
      if (!response.ok) process.exitCode = 1;
    } catch {
      printResult(
        null,
        'network_error',
        'The request failed before an HTTP response was received.',
      );
      process.exitCode = 1;
    }
  }
}
