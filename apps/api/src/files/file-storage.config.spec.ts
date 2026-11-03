import { describe, expect, it } from 'vitest';
import { getFilesConfiguration } from './file-storage.config.js';

describe('getFilesConfiguration', () => {
  it('uses free local storage only outside production', () => {
    expect(getFilesConfiguration({ NODE_ENV: 'development' })).toMatchObject({
      storage: { driver: 'local' },
      security: { scanRequired: false, scanner: { driver: 'none' } },
    });
    expect(() => getFilesConfiguration({ NODE_ENV: 'production' })).toThrow(
      'FILE_STORAGE_DRIVER',
    );
    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 'local',
      }),
    ).toThrow('not allowed in production');
  });

  it('validates production S3 settings and requires scanning by default', () => {
    expect(
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'private-nexus-files',
        FILE_S3_REGION: 'eu-west-1',
      }),
    ).toMatchObject({
      storage: {
        driver: 's3',
        bucket: 'private-nexus-files',
        region: 'eu-west-1',
        prefix: 'nexus',
        forcePathStyle: false,
      },
      security: { scanRequired: true },
    });
  });

  it('rejects attempts to disable production malware scanning', () => {
    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'private-nexus-files',
        FILE_S3_REGION: 'eu-west-1',
        FILE_MALWARE_SCAN_REQUIRED: 'false',
      }),
    ).toThrow('FILE_MALWARE_SCAN_REQUIRED cannot be false in production.');
  });

  it('keeps scanning mandatory when no production scanner is configured', () => {
    expect(
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'private-nexus-files',
        FILE_S3_REGION: 'eu-west-1',
      }),
    ).toMatchObject({
      security: {
        scanRequired: true,
        scanner: { driver: 'none' },
      },
    });
  });

  it('rejects insecure remote production endpoints and invalid values', () => {
    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'private-nexus-files',
        FILE_S3_REGION: 'eu-west-1',
        FILE_S3_ENDPOINT: 'http://storage.example.com',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      getFilesConfiguration({
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'bucket',
        FILE_S3_REGION: 'local',
        FILE_S3_FORCE_PATH_STYLE: 'sometimes',
      }),
    ).toThrow('true or false');
    expect(() =>
      getFilesConfiguration({
        FILE_STORAGE_DRIVER: 'local',
        FILE_MALWARE_SCANNER_DRIVER: 'http',
      }),
    ).toThrow('FILE_MALWARE_SCANNER_URL');
  });
});
