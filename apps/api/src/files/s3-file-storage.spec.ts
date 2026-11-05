import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S3FileStorageProvider } from './s3-file-storage.js';

const storageKey = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';
const send = vi.fn();
const client = { send } as unknown as S3Client;
const storage = new S3FileStorageProvider(
  {
    driver: 's3',
    bucket: 'private-files',
    region: 'eu-west-1',
    prefix: 'tenant-files',
    forcePathStyle: false,
  },
  client,
);

describe('S3FileStorageProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes to quarantine and promotes without setting a public ACL', async () => {
    send.mockResolvedValue({});
    await storage.putQuarantined(storageKey, Buffer.from('safe'), 'text/plain');
    await storage.promoteQuarantined(storageKey);

    const put = send.mock.calls[0][0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: 'private-files',
      Key: `tenant-files/quarantine/${storageKey}`,
      ContentType: 'text/plain',
    });
    expect(put.input).not.toHaveProperty('ACL');
    expect(send.mock.calls[1][0]).toBeInstanceOf(CopyObjectCommand);
    expect(send.mock.calls[1][0].input).toMatchObject({
      Bucket: 'private-files',
      Key: `tenant-files/active/${storageKey}`,
    });
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('opens private objects as streams and reports missing objects safely', async () => {
    send.mockResolvedValueOnce({
      Body: Readable.from(Buffer.from('safe')),
      ContentLength: 4,
    });
    await expect(storage.openActive(storageKey)).resolves.toMatchObject({
      sizeBytes: 4,
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);

    send.mockRejectedValueOnce({ name: 'NotFound' });
    await expect(storage.exists(storageKey, 'active')).resolves.toBe(false);
    expect(send.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('lists only valid generated object keys', async () => {
    send.mockResolvedValue({
      Contents: [
        {
          Key: `tenant-files/active/${storageKey}`,
          LastModified: new Date('2026-11-03T00:00:00.000Z'),
        },
        {
          Key: 'tenant-files/active/user-supplied-name.txt',
          LastModified: new Date('2026-11-03T00:00:00.000Z'),
        },
      ],
      NextContinuationToken: 'next-page',
    });

    await expect(storage.list('active')).resolves.toEqual({
      objects: [
        {
          storageKey,
          lastModified: new Date('2026-11-03T00:00:00.000Z'),
        },
      ],
      nextCursor: 'next-page',
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
  });
});
