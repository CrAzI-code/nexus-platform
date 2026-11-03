import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import {
  FILE_STORAGE_CONFIG,
  type FilesConfiguration,
} from './file-storage.config.js';
import {
  FILE_STORAGE_PROVIDER,
  type FileStorageProvider,
} from './file-storage.js';
import { OrphanedFileCleanupService } from './orphaned-file-cleanup.service.js';

const referencedKey = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const orphanKey = '2c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const recentKey = '3c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const quarantineKey = '4c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const old = new Date('2026-10-30T00:00:00.000Z');
const recent = new Date('2026-11-02T23:30:00.000Z');
const now = new Date('2026-11-03T00:00:00.000Z');
const removeObject = vi.fn();

const storage = {
  putQuarantined: vi.fn(),
  promoteQuarantined: vi.fn(),
  openActive: vi.fn(),
  remove: removeObject,
  exists: vi.fn(),
  list: vi.fn(async (area: 'active' | 'quarantine') => ({
    objects:
      area === 'active'
        ? [
            { storageKey: referencedKey, lastModified: old },
            { storageKey: orphanKey, lastModified: old },
            { storageKey: recentKey, lastModified: recent },
          ]
        : [{ storageKey: quarantineKey, lastModified: old }],
  })),
} as unknown as FileStorageProvider;

const prisma = {
  fileAttachment: {
    findMany: vi.fn().mockResolvedValue([{ storageKey: referencedKey }]),
  },
};

const configuration: FilesConfiguration = {
  storage: { driver: 'local' },
  security: {
    scanRequired: false,
    scanner: { driver: 'none' },
    orphanMinimumAgeMs: 3_600_000,
  },
};

describe('OrphanedFileCleanupService', () => {
  async function createService() {
    vi.clearAllMocks();
    prisma.fileAttachment.findMany.mockResolvedValue([
      { storageKey: referencedKey },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrphanedFileCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: FILE_STORAGE_PROVIDER, useValue: storage },
        { provide: FILE_STORAGE_CONFIG, useValue: configuration },
      ],
    }).compile();
    return module.get(OrphanedFileCleanupService);
  }

  it('defaults to a dry run and never targets referenced or recent objects', async () => {
    const service = await createService();
    await expect(service.cleanup({ now })).resolves.toMatchObject({
      dryRun: true,
      referenced: 1,
      tooRecent: 1,
      candidates: 2,
      removed: 0,
    });
    expect(removeObject).not.toHaveBeenCalled();
  });

  it('removes only old unreferenced active and quarantine objects when applied', async () => {
    const service = await createService();
    await expect(
      service.cleanup({ now, dryRun: false }),
    ).resolves.toMatchObject({ removed: 2 });
    expect(removeObject).toHaveBeenCalledWith(orphanKey, 'active');
    expect(removeObject).toHaveBeenCalledWith(quarantineKey, 'quarantine');
    expect(removeObject).not.toHaveBeenCalledWith(referencedKey, 'active');
    expect(removeObject).not.toHaveBeenCalledWith(recentKey, 'active');
  });
});
