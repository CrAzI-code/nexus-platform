import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalFileStorageProvider } from './file-storage.js';

describe('LocalFileStorageProvider', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('stores bytes under generated keys and reads or removes them', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-private-files-'));
    const storage = new LocalFileStorageProvider(directory);
    const key = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
    const content = Buffer.from('private');

    await storage.putQuarantined(key, content, 'text/plain');
    await expect(readFile(join(directory, 'quarantine', key))).resolves.toEqual(
      content,
    );
    await storage.promoteQuarantined(key);
    await expect(readFile(join(directory, 'active', key))).resolves.toEqual(
      content,
    );
    const stored = await storage.openActive(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(content);
    expect(stored.sizeBytes).toBe(content.length);
    await expect(storage.exists(key, 'active')).resolves.toBe(true);
    await storage.remove(key, 'active');
    await expect(storage.exists(key, 'active')).resolves.toBe(false);
    await expect(storage.remove(key, 'active')).resolves.toBeUndefined();
  });

  it('rejects storage keys that could escape the private directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-private-files-'));
    const storage = new LocalFileStorageProvider(directory);

    await expect(storage.openActive('../secrets')).rejects.toThrow(
      'Invalid internal storage key',
    );
    await expect(
      storage.putQuarantined('user-file.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('Invalid internal storage key');
  });

  it('continues to read legacy UUID objects created by the previous local provider', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-private-files-'));
    const storage = new LocalFileStorageProvider(directory);
    const key = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
    await writeFile(join(directory, key), Buffer.from('legacy'));

    await expect(storage.exists(key, 'active')).resolves.toBe(true);
    const stored = await storage.openActive(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('legacy');
  });
});
