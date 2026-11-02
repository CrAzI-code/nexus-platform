import {
  chmod,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILE_STORAGE_PROVIDER = Symbol('FILE_STORAGE_PROVIDER');

export interface FileStorageProvider {
  write(storageKey: string, content: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export class FileStorageService implements FileStorageProvider {
  constructor(private readonly rootDirectory = resolveStorageDirectory()) {}

  async write(storageKey: string, content: Buffer): Promise<void> {
    const destination = this.getPath(storageKey);
    await this.assertPrivateRoot();
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await this.assertPrivateRoot();
    if (process.platform !== 'win32') {
      await chmod(this.rootDirectory, 0o700);
    }
    await writeFile(destination, content, { flag: 'wx', mode: 0o600 });
  }

  async read(storageKey: string): Promise<Buffer> {
    await this.assertPrivateRoot();
    return readFile(this.getPath(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await this.assertPrivateRoot();
      await unlink(this.getPath(storageKey));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
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
    const relativePath = relative(realPublicDirectory, realStorageDirectory);
    if (
      relativePath === '' ||
      (!relativePath.startsWith(`..${sep}`) &&
        relativePath !== '..' &&
        !isAbsolute(relativePath))
    ) {
      throw new Error(
        'FILE_STORAGE_PATH must resolve outside the web public directory.',
      );
    }
  }

  private getPath(storageKey: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)) {
      throw new Error('Invalid internal storage key.');
    }
    return join(this.rootDirectory, storageKey);
  }
}

function resolveStorageDirectory(): string {
  const apiDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const configuredDirectory = process.env.FILE_STORAGE_PATH?.trim();
  const rootDirectory = configuredDirectory
    ? resolve(apiDirectory, configuredDirectory)
    : resolve(apiDirectory, 'private-files');
  const publicDirectory = resolveWebPublicDirectory();
  const publicRelativePath = relative(publicDirectory, rootDirectory);
  if (
    publicRelativePath === '' ||
    (!publicRelativePath.startsWith(`..${sep}`) &&
      publicRelativePath !== '..' &&
      !isAbsolute(publicRelativePath))
  ) {
    throw new Error('FILE_STORAGE_PATH must be outside the web public directory.');
  }
  return rootDirectory;
}

function resolveWebPublicDirectory(): string {
  const apiDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const repositoryDirectory = resolve(apiDirectory, '..', '..');
  return resolve(repositoryDirectory, 'apps', 'web', 'public');
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
