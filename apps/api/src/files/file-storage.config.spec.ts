import { describe, expect, it } from 'vitest';
import { getFilesConfiguration } from './file-storage.config.js';

describe('getFilesConfiguration', () => {
  it('uses free local storage only outside production', () => {
    expect(getFilesConfiguration({ NODE_ENV: 'development' })).toMatchObject({
      storage: { driver: 'local' },
      security: {
        scanRequired: true,
        scanner: {
          driver: 'clamav',
          host: '127.0.0.1',
          port: 3310,
          timeoutMs: 10_000,
        },
      },
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
    ).toThrow('FILE_MALWARE_SCAN_REQUIRED cannot be false.');
  });

  it('does not allow local development to bypass malware scanning', () => {
    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'development',
        FILE_MALWARE_SCAN_REQUIRED: 'false',
      }),
    ).toThrow('FILE_MALWARE_SCAN_REQUIRED cannot be false.');
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

  it('uses ClamAV by default for local development when scanner settings are omitted', () => {
    expect(
      getFilesConfiguration({
        NODE_ENV: 'development',
        FILE_MALWARE_SCAN_REQUIRED: 'true',
      }).security.scanner,
    ).toEqual({
      driver: 'clamav',
      host: '127.0.0.1',
      port: 3310,
      timeoutMs: 10_000,
    });
  });

  it('preserves an explicit none driver so uploads still fail closed', () => {
    expect(
      getFilesConfiguration({
        NODE_ENV: 'development',
        FILE_MALWARE_SCANNER_DRIVER: 'none',
      }).security.scanner,
    ).toEqual({ driver: 'none' });
  });

  it('configures a local ClamAV daemon using the clamd TCP endpoint', () => {
    expect(
      getFilesConfiguration({
        NODE_ENV: 'development',
        FILE_MALWARE_SCAN_REQUIRED: 'true',
        FILE_MALWARE_SCANNER_DRIVER: 'clamav',
      }),
    ).toMatchObject({
      security: {
        scanRequired: true,
        scanner: {
          driver: 'clamav',
          host: '127.0.0.1',
          port: 3310,
          timeoutMs: 10_000,
        },
      },
    });
  });

  it('requires an explicit scanner host and valid port in production', () => {
    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 's3',
        FILE_S3_BUCKET: 'private-nexus-files',
        FILE_S3_REGION: 'us-east-1',
        FILE_MALWARE_SCANNER_DRIVER: 'clamav',
      }),
    ).toThrow('FILE_MALWARE_SCANNER_HOST');

    expect(() =>
      getFilesConfiguration({
        NODE_ENV: 'development',
        FILE_MALWARE_SCANNER_DRIVER: 'clamav',
        FILE_MALWARE_SCANNER_PORT: '70000',
      }),
    ).toThrow('FILE_MALWARE_SCANNER_PORT');
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
