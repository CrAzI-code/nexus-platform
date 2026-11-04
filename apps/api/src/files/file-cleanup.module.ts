import { Module } from '@nestjs/common';
import { FilesModule } from './files.module.js';

@Module({
  imports: [FilesModule],
})
export class FileCleanupModule {}
