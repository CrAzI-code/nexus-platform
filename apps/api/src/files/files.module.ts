import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import {
  FILE_STORAGE_CONFIG,
  getFilesConfiguration,
  type FilesConfiguration,
} from './file-storage.config.js';
import {
  FILE_STORAGE_PROVIDER,
  LocalFileStorageProvider,
} from './file-storage.js';
import { FilesController } from './files.controller.js';
import { OrganizationFilesController } from './organization-files.controller.js';
import { FilesService } from './files.service.js';
import { ClamAvMalwareScanner } from './clamav-malware-scanner.js';
import {
  HttpMalwareScanner,
  MALWARE_SCANNER_PROVIDER,
  UnavailableMalwareScanner,
} from './malware-scanner.js';
import { OrphanedFileCleanupService } from './orphaned-file-cleanup.service.js';
import { S3FileStorageProvider } from './s3-file-storage.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FilesController, OrganizationFilesController],
  providers: [
    ClerkAuthGuard,
    FilesService,
    {
      provide: FILE_STORAGE_CONFIG,
      useFactory: () => getFilesConfiguration(process.env),
    },
    {
      provide: FILE_STORAGE_PROVIDER,
      inject: [FILE_STORAGE_CONFIG],
      useFactory: (configuration: FilesConfiguration) =>
        configuration.storage.driver === 's3'
          ? new S3FileStorageProvider(configuration.storage)
          : new LocalFileStorageProvider(),
    },
    {
      provide: MALWARE_SCANNER_PROVIDER,
      inject: [FILE_STORAGE_CONFIG],
      useFactory: (configuration: FilesConfiguration) => {
        const scanner = configuration.security.scanner;
        if (scanner.driver === 'http') return new HttpMalwareScanner(scanner);
        if (scanner.driver === 'clamav') return new ClamAvMalwareScanner(scanner);
        return new UnavailableMalwareScanner();
      },
    },
    OrphanedFileCleanupService,
  ],
  exports: [OrphanedFileCleanupService],
})
export class FilesModule {}
