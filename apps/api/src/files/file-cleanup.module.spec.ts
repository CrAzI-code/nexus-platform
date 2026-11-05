import { describe, expect, it } from 'vitest';
import { FilesModule } from './files.module.js';
import { FileCleanupModule } from './file-cleanup.module.js';

describe('FileCleanupModule', () => {
  it('imports only FilesModule instead of starting unrelated application workers', () => {
    expect(Reflect.getMetadata('imports', FileCleanupModule)).toEqual([
      FilesModule,
    ]);
  });
});
