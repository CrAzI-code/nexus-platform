import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export interface FileListQuery {
  page: number;
  pageSize: number;
}

@Injectable()
export class FileListPipe implements PipeTransform<unknown, FileListQuery> {
  transform(value: unknown): FileListQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('File list options must be query values.');
    }

    const query = value as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'page' && key !== 'pageSize')) {
      throw new BadRequestException('Unsupported file list option.');
    }

    return {
      page: readPositiveInteger(query, 'page', 1, 10_000),
      pageSize: readPositiveInteger(query, 'pageSize', 25, 100),
    };
  }
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
