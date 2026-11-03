import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { OrphanedFileCleanupService } from './orphaned-file-cleanup.service.js';

const logger = new Logger('FileCleanup');
const apply = process.argv.slice(2).includes('--apply');
const application = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn', 'log'],
});

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
