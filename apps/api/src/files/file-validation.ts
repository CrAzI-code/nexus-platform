import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_UPLOAD_HARD_LIMIT = 25 * 1024 * 1024;

const allowedTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
]);

export interface UploadFileData {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ValidatedUpload {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

export function validateFileUpload(
  file: UploadFileData,
  maximumBytes = getMaximumFileUploadSize(),
): ValidatedUpload {
  const originalName = file.originalname;
  if (
    originalName.length === 0 ||
    Array.from(originalName).length > 255 ||
    hasUnsafeFilenameCharacter(originalName)
  ) {
    throw new BadRequestException('Choose a file with a valid filename.');
  }

  const extension = extname(originalName).toLowerCase();
  const expectedMimeType = allowedTypes.get(extension);
  if (!expectedMimeType || file.mimetype.toLowerCase() !== expectedMimeType) {
    throw new BadRequestException(
      'This file type is not supported or its extension does not match its type.',
    );
  }

  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new BadRequestException('The selected file is empty or invalid.');
  }
  if (
    file.size !== file.buffer.length ||
    file.buffer.length > maximumBytes
  ) {
    throw new BadRequestException('The selected file is too large or invalid.');
  }

  if (!hasValidSignature(expectedMimeType, file.buffer)) {
    throw new BadRequestException(
      'The selected file content does not match its declared type.',
    );
  }

  return {
    originalName,
    mimeType: expectedMimeType,
    sizeBytes: file.buffer.length,
    buffer: file.buffer,
  };
}

export function supportsInlinePreview(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/webp'
  );
}

function hasValidSignature(mimeType: string, buffer: Buffer): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'image/png':
      return buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    case 'image/jpeg':
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'text/plain':
    case 'text/csv':
      return isSafeUtf8Text(buffer);
    default:
      return false;
  }
}

function isSafeUtf8Text(buffer: Buffer): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasUnsafeFilenameCharacter(filename: string): boolean {
  for (const character of filename) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === '/' ||
      character === '\\' ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

export function getMaximumFileUploadSize(): number {
  const configured = process.env.FILE_MAX_UPLOAD_BYTES;
  if (configured === undefined || configured.trim() === '') {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  const value = Number(configured);
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_FILE_UPLOAD_HARD_LIMIT
  ) {
    throw new Error(
      `FILE_MAX_UPLOAD_BYTES must be between 1 and ${MAX_FILE_UPLOAD_HARD_LIMIT}.`,
    );
  }
  return value;
}
