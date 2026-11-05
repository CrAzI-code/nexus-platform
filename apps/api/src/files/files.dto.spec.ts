import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FileListPipe } from './files.dto.js';

describe('FileListPipe', () => {
  const pipe = new FileListPipe();

  it('uses bounded defaults and accepts valid pagination', () => {
    expect(pipe.transform({})).toEqual({ page: 1, pageSize: 25 });
    expect(pipe.transform({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
  });

  it('accepts supported search, type, scan, and sort filters', () => {
    expect(
      pipe.transform({
        search: '  budget ',
        type: 'documents',
        scanStatus: 'UNSCANNED',
        sort: 'name',
      }),
    ).toEqual({
      page: 1,
      pageSize: 25,
      search: 'budget',
      type: 'documents',
      scanStatus: 'UNSCANNED',
      sort: 'name',
    });
  });

  it('rejects repeated, unknown, and out-of-range options', () => {
    expect(() => pipe.transform({ page: ['1', '2'] })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ fileId: 'other-tenant-file' })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ pageSize: '101' })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ type: 'all' })).toThrow(BadRequestException);
    expect(() => pipe.transform({ sort: 'arbitrary' })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ search: 'x'.repeat(101) })).toThrow(
      BadRequestException,
    );
  });
});
