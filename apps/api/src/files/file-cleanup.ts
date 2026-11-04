import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { FileCleanupModule } from './file-cleanup.module.js';
import { OrphanedFileCleanupService } from './orphaned-file-cleanup.service.js';

const logger = new Logger('FileCleanup');
const apply = process.argv.slice(2).includes('--apply');
const apiEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
dotenv.config({
  path: apiEnvPath,
  override: process.env.NODE_ENV !== 'production',
});
const application = await NestFactory.createApplicationContext(
  FileCleanupModule,
  {
    logger: ['error', 'warn', 'log'],
  },
);

try {
  const cleanup = application.get(OrphanedFileCleanupService);
  const report = await cleanup.cleanup({ dryRun: !apply });
  logger.log(JSON.stringify(report));
  if (!apply) {
    logger.log(
      'Dry run only. Pass --apply to remove eligible orphaned objects.',
    );
  }
} finally {
  await application.close();
}
