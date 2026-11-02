import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import {
  FILE_STORAGE_PROVIDER,
  FileStorageService,
} from './file-storage.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FilesController],
  providers: [
    ClerkAuthGuard,
    FilesService,
    {
      provide: FileStorageService,
      useFactory: () => new FileStorageService(),
    },
    { provide: FILE_STORAGE_PROVIDER, useExisting: FileStorageService },
  ],
})
export class FilesModule {}
