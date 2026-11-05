import { constants, createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const FILE_STORAGE_PROVIDER = Symbol('FILE_STORAGE_PROVIDER');

export type FileStorageArea = 'active' | 'quarantine';

export interface StoredFileObject {
  stream: Readable;
  sizeBytes: number;
}

export interface ListedFileObject {
  storageKey: string;
  lastModified: Date;
}

export interface FileObjectPage {
  objects: ListedFileObject[];
  nextCursor?: string;
}

export interface FileStorageProvider {
  putQuarantined(
    storageKey: string,
    content: Buffer,
    mimeType: string,
  ): Promise<void>;
  promoteQuarantined(storageKey: string): Promise<void>;
  openActive(storageKey: string): Promise<StoredFileObject>;
  remove(storageKey: string, area: FileStorageArea): Promise<void>;
  exists(storageKey: string, area: FileStorageArea): Promise<boolean>;
  list(
    area: FileStorageArea,
    options?: { cursor?: string; limit?: number },
  ): Promise<FileObjectPage>;
}

export class LocalFileStorageProvider implements FileStorageProvider {
  constructor(private readonly rootDirectory = resolveStorageDirectory()) {}

  async putQuarantined(
    storageKey: string,
    content: Buffer,
    _mimeType: string,
  ): Promise<void> {
    await this.prepareDirectories();
    await writeFile(this.getPath('quarantine', storageKey), content, {
      flag: 'wx',
      mode: 0o600,
    });
  }

  async promoteQuarantined(storageKey: string): Promise<void> {
    await this.prepareDirectories();
    const source = this.getPath('quarantine', storageKey);
    const destination = this.getPath('active', storageKey);
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await unlink(source);
  }

  async openActive(storageKey: string): Promise<StoredFileObject> {
    await this.assertPrivateRoot();
    const path = await this.resolveActivePath(storageKey);
    const metadata = await stat(path);
    if (!metadata.isFile()) throw objectNotFoundError();
    return {
      stream: createReadStream(path),
      sizeBytes: metadata.size,
    };
  }

  async remove(storageKey: string, area: FileStorageArea): Promise<void> {
    await this.assertPrivateRoot();
    const paths = [this.getPath(area, storageKey)];
    if (area === 'active') paths.push(this.getLegacyPath(storageKey));

    for (const path of paths) {
      try {
        await unlink(path);
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
  }

  async exists(storageKey: string, area: FileStorageArea): Promise<boolean> {
    await this.assertPrivateRoot();
    const paths = [this.getPath(area, storageKey)];
    if (area === 'active') paths.push(this.getLegacyPath(storageKey));
    for (const path of paths) {
      try {
        const metadata = await stat(path);
        if (metadata.isFile()) return true;
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
    return false;
  }

  async list(
    area: FileStorageArea,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<FileObjectPage> {
    await this.prepareDirectories();
    const limit = normalizeListLimit(options.limit);
    const objects = new Map<string, ListedFileObject>();
    await this.collectDirectoryObjects(join(this.rootDirectory, area), objects);
    if (area === 'active') await this.collectLegacyObjects(objects);

    const sorted = [...objects.values()]
      .filter((object) => !options.cursor || object.storageKey > options.cursor)
      .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
    const page = sorted.slice(0, limit);
    const lastObject = page.at(-1);
    return {
      objects: page,
      ...(sorted.length > limit && lastObject
        ? { nextCursor: lastObject.storageKey }
        : {}),
    };
  }

  private async collectDirectoryObjects(
    directory: string,
    objects: Map<string, ListedFileObject>,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !isValidStorageKey(entry.name)) continue;
      const metadata = await stat(join(directory, entry.name));
      objects.set(entry.name, {
        storageKey: entry.name,
        lastModified: metadata.mtime,
      });
    }
  }

  private async collectLegacyObjects(
    objects: Map<string, ListedFileObject>,
  ): Promise<void> {
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !isValidStorageKey(entry.name)) continue;
      const metadata = await stat(this.getLegacyPath(entry.name));
      if (!objects.has(entry.name)) {
        objects.set(entry.name, {
          storageKey: entry.name,
          lastModified: metadata.mtime,
        });
      }
    }
  }

  private async resolveActivePath(storageKey: string): Promise<string> {
    const activePath = this.getPath('active', storageKey);
    try {
      await stat(activePath);
      return activePath;
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
    const legacyPath = this.getLegacyPath(storageKey);
    try {
      await stat(legacyPath);
      return legacyPath;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) throw objectNotFoundError();
      throw error;
    }
  }

  private async prepareDirectories(): Promise<void> {
    await this.assertPrivateRoot();
    await mkdir(join(this.rootDirectory, 'active'), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(this.rootDirectory, 'quarantine'), {
      recursive: true,
      mode: 0o700,
    });
    await this.assertPrivateRoot();
    if (process.platform !== 'win32') {
      await chmod(this.rootDirectory, 0o700);
      await chmod(join(this.rootDirectory, 'active'), 0o700);
      await chmod(join(this.rootDirectory, 'quarantine'), 0o700);
    }
  }

  private async assertPrivateRoot(): Promise<void> {
    const publicDirectory = resolveWebPublicDirectory();
    const [realPublicDirectory, realStorageDirectory] = await Promise.all([
      realpath(publicDirectory).catch((error: unknown) => {
        if (hasErrorCode(error, 'ENOENT')) return publicDirectory;
        throw error;
      }),
      realpathToExistingAncestor(this.rootDirectory),
    ]);
    if (isWithin(relative(realPublicDirectory, realStorageDirectory))) {
      throw new Error(
        'FILE_STORAGE_PATH must resolve outside the web public directory.',
      );
    }
  }

  private getPath(area: FileStorageArea, storageKey: string): string {
    assertValidStorageKey(storageKey);
    return join(this.rootDirectory, area, storageKey);
  }

  private getLegacyPath(storageKey: string): string {
    assertValidStorageKey(storageKey);
    return join(this.rootDirectory, storageKey);
  }
}

export function assertValidStorageKey(storageKey: string): void {
  if (!isValidStorageKey(storageKey)) {
    throw new Error('Invalid internal storage key.');
  }
}

export function isValidStorageKey(storageKey: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    storageKey,
  );
}

export function objectNotFoundError(): Error & { code: 'ENOENT' } {
  return Object.assign(new Error('Stored object was not found.'), {
    code: 'ENOENT' as const,
  });
}

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined) return 250;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Storage list limit must be between 1 and 1000.');
  }
  return limit;
}

function resolveStorageDirectory(): string {
  const apiDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const configuredDirectory = process.env.FILE_STORAGE_PATH?.trim();
  const rootDirectory = configuredDirectory
    ? resolve(apiDirectory, configuredDirectory)
    : resolve(apiDirectory, 'private-files');
  if (isWithin(relative(resolveWebPublicDirectory(), rootDirectory))) {
    throw new Error(
      'FILE_STORAGE_PATH must be outside the web public directory.',
    );
  }
  return rootDirectory;
}

function resolveWebPublicDirectory(): string {
  const apiDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const repositoryDirectory = resolve(apiDirectory, '..', '..');
  return resolve(repositoryDirectory, 'apps', 'web', 'public');
}

function isWithin(relativePath: string): boolean {
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== '..' &&
      !isAbsolute(relativePath))
  );
}

async function realpathToExistingAncestor(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
