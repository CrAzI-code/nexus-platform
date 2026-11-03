export const FILE_STORAGE_CONFIG = Symbol('FILE_STORAGE_CONFIG');

export type FileStorageConfig =
  | {
      driver: 'local';
    }
  | {
      driver: 's3';
      bucket: string;
      region: string;
      prefix: string;
      endpoint?: string;
      forcePathStyle: boolean;
    };

export interface FileSecurityConfig {
  scanRequired: boolean;
  scanner:
    | { driver: 'none' }
    | {
        driver: 'http';
        url: string;
        token?: string;
        timeoutMs: number;
      };
  orphanMinimumAgeMs: number;
}

export interface FilesConfiguration {
  storage: FileStorageConfig;
  security: FileSecurityConfig;
}

export function getFilesConfiguration(
  environment: NodeJS.ProcessEnv,
): FilesConfiguration {
  const production = environment.NODE_ENV === 'production';
  const configuredDriver =
    environment.FILE_STORAGE_DRIVER?.trim().toLowerCase();
  const driver = configuredDriver || (production ? undefined : 'local');
  if (driver !== 'local' && driver !== 's3') {
    throw new Error(
      'FILE_STORAGE_DRIVER must be explicitly set to s3 in production or to local/s3 outside production.',
    );
  }
  if (production && driver === 'local') {
    throw new Error('Local file storage is not allowed in production.');
  }

  const storage: FileStorageConfig =
    driver === 'local'
      ? { driver: 'local' }
      : {
          driver: 's3',
          bucket: parseBucket(required(environment, 'FILE_S3_BUCKET')),
          region: parseRegion(required(environment, 'FILE_S3_REGION')),
          prefix: parsePrefix(environment.FILE_S3_PREFIX),
          forcePathStyle: parseBoolean(
            environment.FILE_S3_FORCE_PATH_STYLE,
            false,
            'FILE_S3_FORCE_PATH_STYLE',
          ),
          ...parseEndpoint(environment.FILE_S3_ENDPOINT, production),
        };

  const scanRequired = parseBoolean(
    environment.FILE_MALWARE_SCAN_REQUIRED,
    production,
    'FILE_MALWARE_SCAN_REQUIRED',
  );
  if (production && !scanRequired) {
    throw new Error(
      'FILE_MALWARE_SCAN_REQUIRED cannot be false in production.',
    );
  }
  const scannerDriver =
    environment.FILE_MALWARE_SCANNER_DRIVER?.trim().toLowerCase() || 'none';
  if (scannerDriver !== 'none' && scannerDriver !== 'http') {
    throw new Error('FILE_MALWARE_SCANNER_DRIVER must be none or http.');
  }
  const scanner: FileSecurityConfig['scanner'] =
    scannerDriver === 'none'
      ? { driver: 'none' }
      : {
          driver: 'http',
          url: parseScannerUrl(
            required(environment, 'FILE_MALWARE_SCANNER_URL'),
            production,
          ),
          timeoutMs: parseInteger(
            environment.FILE_MALWARE_SCANNER_TIMEOUT_MS,
            10_000,
            1_000,
            60_000,
            'FILE_MALWARE_SCANNER_TIMEOUT_MS',
          ),
          ...(environment.FILE_MALWARE_SCANNER_TOKEN?.trim()
            ? { token: environment.FILE_MALWARE_SCANNER_TOKEN.trim() }
            : {}),
        };

  return {
    storage,
    security: {
      scanRequired,
      scanner,
      orphanMinimumAgeMs:
        parseInteger(
          environment.FILE_ORPHAN_MIN_AGE_SECONDS,
          86_400,
          3_600,
          2_592_000,
          'FILE_ORPHAN_MIN_AGE_SECONDS',
        ) * 1_000,
    },
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parsePrefix(value: string | undefined): string {
  const prefix = value?.trim() || 'nexus';
  if (
    prefix.length > 128 ||
    prefix.startsWith('/') ||
    prefix.endsWith('/') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/u.test(prefix)
  ) {
    throw new Error('FILE_S3_PREFIX must be a safe object-key prefix.');
  }
  return prefix;
}

function parseBucket(value: string): string {
  if (
    value.length < 3 ||
    value.length > 255 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/u.test(value)
  ) {
    throw new Error('FILE_S3_BUCKET contains invalid characters.');
  }
  return value;
}

function parseRegion(value: string): string {
  if (value.length > 64 || !/^[a-zA-Z0-9-]+$/u.test(value)) {
    throw new Error('FILE_S3_REGION contains invalid characters.');
  }
  return value;
}

function parseEndpoint(
  value: string | undefined,
  production: boolean,
): { endpoint?: string } {
  if (!value?.trim()) return {};
  const endpoint = new URL(value.trim());
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('FILE_S3_ENDPOINT must be an HTTP or HTTPS URL.');
  }
  if (
    production &&
    endpoint.protocol !== 'https:' &&
    !isLoopback(endpoint.hostname)
  ) {
    throw new Error('FILE_S3_ENDPOINT must use HTTPS in production.');
  }
  return { endpoint: endpoint.toString().replace(/\/$/u, '') };
}

function parseScannerUrl(value: string, production: boolean): string {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('FILE_MALWARE_SCANNER_URL must be an HTTP or HTTPS URL.');
  }
  if (production && url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    throw new Error(
      'FILE_MALWARE_SCANNER_URL must use HTTPS in production unless it is a loopback sidecar.',
    );
  }
  return url.toString();
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}
