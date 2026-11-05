import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export interface FileListQuery {
  page: number;
  pageSize: number;
  search?: string;
  type?: 'images' | 'documents' | 'text';
  scanStatus?: 'CLEAN' | 'UNSCANNED';
  sort?: 'recent' | 'name' | 'size';
}

@Injectable()
export class FileListPipe implements PipeTransform<unknown, FileListQuery> {
  transform(value: unknown): FileListQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('File list options must be query values.');
    }

    const query = value as Record<string, unknown>;
    const supportedOptions = new Set([
      'page',
      'pageSize',
      'search',
      'type',
      'scanStatus',
      'sort',
    ]);
    if (Object.keys(query).some((key) => !supportedOptions.has(key))) {
      throw new BadRequestException('Unsupported file list option.');
    }

    const search = readOptionalString(query, 'search', 100);
    const type = readOption(query, 'type', ['images', 'documents', 'text']);
    const scanStatus = readOption(query, 'scanStatus', ['CLEAN', 'UNSCANNED']);
    const sort = readOption(query, 'sort', ['recent', 'name', 'size']);
    return {
      page: readPositiveInteger(query, 'page', 1, 10_000),
      pageSize: readPositiveInteger(query, 'pageSize', 25, 100),
      ...(search ? { search } : {}),
      ...(type ? { type } : {}),
      ...(scanStatus ? { scanStatus } : {}),
      ...(sort ? { sort } : {}),
    };
  }
}

function readOptionalString(
  query: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new BadRequestException(
      `${key} must be a string with at most ${maximumLength} characters.`,
    );
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function readOption<const T extends readonly string[]>(
  query: Record<string, unknown>,
  key: string,
  options: T,
): T[number] | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new BadRequestException(`${key} is not a supported file list option.`);
  }
  return value;
}

function readPositiveInteger(
  query: Record<string, unknown>,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const value = query[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(`${key} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new BadRequestException(`${key} must be between 1 and ${maximum}.`);
  }
  return parsed;
}
