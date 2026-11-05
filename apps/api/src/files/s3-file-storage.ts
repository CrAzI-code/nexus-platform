import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { FileStorageConfig } from './file-storage.config.js';
import {
  assertValidStorageKey,
  isValidStorageKey,
  objectNotFoundError,
  type FileObjectPage,
  type FileStorageArea,
  type FileStorageProvider,
  type StoredFileObject,
} from './file-storage.js';

type S3Configuration = Extract<FileStorageConfig, { driver: 's3' }>;

export class S3FileStorageProvider implements FileStorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly config: S3Configuration,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      });
  }

  async putQuarantined(
    storageKey: string,
    content: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey('quarantine', storageKey),
        Body: content,
        ContentLength: content.length,
        ContentType: mimeType,
      }),
    );
  }

  async promoteQuarantined(storageKey: string): Promise<void> {
    const sourceKey = this.objectKey('quarantine', storageKey);
    const destinationKey = this.objectKey('active', storageKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: destinationKey,
        CopySource: encodeCopySource(this.config.bucket, sourceKey),
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: sourceKey,
      }),
    );
  }

  async openActive(storageKey: string): Promise<StoredFileObject> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey('active', storageKey),
        }),
      );
      if (!(response.Body instanceof Readable)) {
        throw new Error('S3 returned an unsupported streaming body.');
      }
      const sizeBytes = response.ContentLength;
      if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes)) {
        throw new Error('S3 did not return an object length.');
      }
      return {
        stream: response.Body,
        sizeBytes,
      };
    } catch (error) {
      if (isMissingObjectError(error)) throw objectNotFoundError();
      throw error;
    }
  }

  async remove(storageKey: string, area: FileStorageArea): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(area, storageKey),
      }),
    );
  }

  async exists(storageKey: string, area: FileStorageArea): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(area, storageKey),
        }),
      );
      return true;
    } catch (error) {
      if (isMissingObjectError(error)) return false;
      throw error;
    }
  }

  async list(
    area: FileStorageArea,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<FileObjectPage> {
    const prefix = `${this.config.prefix}/${area}/`;
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        ContinuationToken: options.cursor,
        MaxKeys: options.limit ?? 250,
      }),
    );
    return {
      objects: (response.Contents ?? []).flatMap((object) => {
        const storageKey = object.Key?.slice(prefix.length);
        if (
          !storageKey ||
          !isValidStorageKey(storageKey) ||
          !object.LastModified
        ) {
          return [];
        }
        return [{ storageKey, lastModified: object.LastModified }];
      }),
      ...(response.NextContinuationToken
        ? { nextCursor: response.NextContinuationToken }
        : {}),
    };
  }

  private objectKey(area: FileStorageArea, storageKey: string): string {
    assertValidStorageKey(storageKey);
    return `${this.config.prefix}/${area}/${storageKey}`;
  }
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (
    'name' in error &&
    (error.name === 'NotFound' || error.name === 'NoSuchKey')
  ) {
    return true;
  }
  if ('$metadata' in error) {
    const metadata = error.$metadata;
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      'httpStatusCode' in metadata &&
      metadata.httpStatusCode === 404
    );
  }
  return false;
}
