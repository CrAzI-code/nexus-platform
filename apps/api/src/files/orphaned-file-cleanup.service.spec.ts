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
const removedKey = '5c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const recentlyRemovedKey = '6c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const quarantineActiveKey = '7c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const quarantineRemovedKey = '8c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const old = new Date('2026-10-30T00:00:00.000Z');
const recent = new Date('2026-11-02T23:30:00.000Z');
const now = new Date('2026-11-03T00:00:00.000Z');
const removeObject = vi.fn();
const deletedKeys = new Set<string>();

const objectsByArea = {
  active: [
    { storageKey: referencedKey, lastModified: old },
    { storageKey: orphanKey, lastModified: old },
    { storageKey: recentKey, lastModified: recent },
    { storageKey: removedKey, lastModified: old },
    { storageKey: recentlyRemovedKey, lastModified: old },
  ],
  quarantine: [
    { storageKey: quarantineKey, lastModified: old },
    { storageKey: quarantineActiveKey, lastModified: old },
    { storageKey: quarantineRemovedKey, lastModified: old },
  ],
};

const fileRecords = [
  { storageKey: referencedKey, removedAt: null },
  { storageKey: removedKey, removedAt: old },
  { storageKey: recentlyRemovedKey, removedAt: recent },
  { storageKey: quarantineActiveKey, removedAt: null },
  { storageKey: quarantineRemovedKey, removedAt: old },
];

const storage = {
  putQuarantined: vi.fn(),
  promoteQuarantined: vi.fn(),
  openActive: vi.fn(),
  remove: removeObject.mockImplementation(
    async (storageKey: string, _area: 'active' | 'quarantine') => {
      deletedKeys.add(storageKey);
    },
  ),
  exists: vi.fn(),
  list: vi.fn(async (area: 'active' | 'quarantine') => ({
    objects: objectsByArea[area].filter(
      (object) => !deletedKeys.has(object.storageKey),
    ),
  })),
} as unknown as FileStorageProvider;

const prisma = {
  fileAttachment: {
    findMany: vi.fn(async (query: { where: { storageKey: { in: string[] } } }) =>
      fileRecords.filter((row) =>
        query.where.storageKey.in.includes(row.storageKey),
      ),
    ),
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
    deletedKeys.clear();
    removeObject.mockImplementation(
      async (storageKey: string, _area: 'active' | 'quarantine') => {
        deletedKeys.add(storageKey);
      },
    );
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

  it('defaults to a dry run and keeps active references and recent objects', async () => {
    const service = await createService();
    await expect(service.cleanup({ now })).resolves.toMatchObject({
      dryRun: true,
      examined: 8,
      referenced: 2,
      tooRecent: 2,
      candidates: 4,
      removed: 0,
    });
    expect(removeObject).not.toHaveBeenCalled();
  });

  it('removes aged orphans and removed records but never active references', async () => {
    const service = await createService();
    await expect(
      service.cleanup({ now, dryRun: false }),
    ).resolves.toMatchObject({ removed: 4 });
    expect(removeObject).toHaveBeenCalledWith(orphanKey, 'active');
    expect(removeObject).toHaveBeenCalledWith(removedKey, 'active');
    expect(removeObject).toHaveBeenCalledWith(quarantineKey, 'quarantine');
    expect(removeObject).toHaveBeenCalledWith(
      quarantineRemovedKey,
      'quarantine',
    );
    expect(removeObject).not.toHaveBeenCalledWith(referencedKey, 'active');
    expect(removeObject).not.toHaveBeenCalledWith(
      quarantineActiveKey,
      'quarantine',
    );
    expect(removeObject).not.toHaveBeenCalledWith(recentlyRemovedKey, 'active');
    expect(removeObject).not.toHaveBeenCalledWith(recentKey, 'active');
  });

  it('is safe to rerun after successful cleanup', async () => {
    const service = await createService();
    await service.cleanup({ now, dryRun: false });
    await expect(
      service.cleanup({ now, dryRun: false }),
    ).resolves.toMatchObject({
      examined: 4,
      candidates: 0,
      removed: 0,
    });
    expect(removeObject).toHaveBeenCalledTimes(4);
  });

  it('surfaces cleanup failures so a later run can retry', async () => {
    const service = await createService();
    removeObject.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      service.cleanup({ now, dryRun: false }),
    ).rejects.toThrow('provider unavailable');
    expect(deletedKeys.size).toBe(0);

    await expect(
      service.cleanup({ now, dryRun: false }),
    ).resolves.toMatchObject({ removed: 4 });
    expect(removeObject).toHaveBeenCalledTimes(5);
  });
});
