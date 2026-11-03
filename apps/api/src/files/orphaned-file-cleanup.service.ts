import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  FILE_STORAGE_CONFIG,
  type FilesConfiguration,
} from './file-storage.config.js';
import {
  FILE_STORAGE_PROVIDER,
  type FileStorageArea,
  type FileStorageProvider,
  type ListedFileObject,
} from './file-storage.js';

export interface FileCleanupReport {
  dryRun: boolean;
  examined: number;
  referenced: number;
  tooRecent: number;
  candidates: number;
  removed: number;
}

@Injectable()
export class OrphanedFileCleanupService {
  private readonly logger = new Logger(OrphanedFileCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_PROVIDER)
    private readonly storage: FileStorageProvider,
    @Inject(FILE_STORAGE_CONFIG)
    private readonly configuration: FilesConfiguration,
  ) {}

  async cleanup(
    options: {
      dryRun?: boolean;
      now?: Date;
    } = {},
  ): Promise<FileCleanupReport> {
    const dryRun = options.dryRun ?? true;
    const cutoff = new Date(
      (options.now ?? new Date()).getTime() -
        this.configuration.security.orphanMinimumAgeMs,
    );
    const report: FileCleanupReport = {
      dryRun,
      examined: 0,
      referenced: 0,
      tooRecent: 0,
      candidates: 0,
      removed: 0,
    };

    await this.cleanupArea('active', cutoff, report);
    await this.cleanupArea('quarantine', cutoff, report);
    this.logger.log(
      JSON.stringify({ event: 'orphaned_file_cleanup_completed', ...report }),
    );
    return report;
  }

  private async cleanupArea(
    area: FileStorageArea,
    cutoff: Date,
    report: FileCleanupReport,
  ): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.storage.list(area, { cursor, limit: 250 });
      report.examined += page.objects.length;
      const fileRecords = await this.findFileRecords(page.objects);

      for (const object of page.objects) {
        const fileRecord = fileRecords.get(object.storageKey);
        if (fileRecord && fileRecord.removedAt === null) {
          report.referenced += 1;
          continue;
        }
        if (
          object.lastModified > cutoff ||
          (fileRecord?.removedAt && fileRecord.removedAt > cutoff)
        ) {
          report.tooRecent += 1;
          continue;
        }
        report.candidates += 1;
        if (!report.dryRun) {
          await this.storage.remove(object.storageKey, area);
          report.removed += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  private async findFileRecords(
    objects: ListedFileObject[],
  ): Promise<Map<string, { removedAt: Date | null }>> {
    if (!objects.length) return new Map();
    const rows = await this.prisma.fileAttachment.findMany({
      where: {
        storageKey: { in: objects.map((object) => object.storageKey) },
      },
      select: { storageKey: true, removedAt: true },
    });
    return new Map(
      rows.map((row) => [row.storageKey, { removedAt: row.removedAt }]),
    );
  }
}
