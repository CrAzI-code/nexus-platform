import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStorageService } from './file-storage.js';

describe('FileStorageService', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('stores bytes under generated keys and reads or removes them', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-private-files-'));
    const storage = new FileStorageService(directory);
    const key = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
    const content = Buffer.from('private');

    await storage.write(key, content);
    await expect(readFile(join(directory, key))).resolves.toEqual(content);
    await expect(storage.read(key)).resolves.toEqual(content);
    await storage.remove(key);
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });

  it('rejects storage keys that could escape the private directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-private-files-'));
    const storage = new FileStorageService(directory);

    await expect(storage.read('../secrets')).rejects.toThrow(
      'Invalid internal storage key',
    );
    await expect(storage.write('user-file.txt', Buffer.from('x'))).rejects.toThrow(
      'Invalid internal storage key',
    );
  });
});
