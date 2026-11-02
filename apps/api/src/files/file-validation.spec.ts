import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  supportsInlinePreview,
  validateFileUpload,
} from './file-validation.js';

function upload(
  originalname: string,
  mimetype: string,
  content: Buffer,
) {
  return {
    originalname,
    mimetype,
    size: content.length,
    buffer: content,
  };
}

describe('validateFileUpload', () => {
  it('accepts supported formats only when their signature and declared type match', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const webp = Buffer.from('RIFF0000WEBP');
    const pdf = Buffer.from('%PDF-1.7');

    expect(validateFileUpload(upload('report.pdf', 'application/pdf', pdf))).toMatchObject({
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
    });
    expect(validateFileUpload(upload('image.png', 'image/png', png)).mimeType).toBe(
      'image/png',
    );
    expect(
      validateFileUpload(upload('image.jpg', 'image/jpeg', jpeg)).mimeType,
    ).toBe('image/jpeg');
    expect(
      validateFileUpload(upload('image.webp', 'image/webp', webp)).mimeType,
    ).toBe('image/webp');
    expect(
      validateFileUpload(upload('notes.txt', 'text/plain', Buffer.from('Hello\n'))).mimeType,
    ).toBe('text/plain');
    expect(
      validateFileUpload(upload('table.csv', 'text/csv', Buffer.from('a,b\n1,2'))).mimeType,
    ).toBe('text/csv');
  });

  it('rejects extension, MIME, or signature mismatches and unsupported active formats', () => {
    expect(() =>
      validateFileUpload(
        upload('photo.png', 'image/png', Buffer.from('<svg></svg>')),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateFileUpload(
        upload('photo.jpg', 'image/png', Buffer.from([0xff, 0xd8, 0xff])),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateFileUpload(
        upload('page.svg', 'image/svg+xml', Buffer.from('<svg/>')),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateFileUpload(
        upload('script.txt', 'text/plain', Buffer.from([0x61, 0x00, 0x62])),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateFileUpload(
        upload('data.csv', 'text/csv', Buffer.from([0xff, 0xfe, 0xfd])),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects path-like names and uploads above the configured limit', () => {
    const content = Buffer.from('text');
    expect(() =>
      validateFileUpload(upload('../notes.txt', 'text/plain', content)),
    ).toThrow(BadRequestException);
    expect(() =>
      validateFileUpload(upload('notes.txt', 'text/plain', content), 3),
    ).toThrow(BadRequestException);
  });

  it('only allows previews for safe raster images and PDFs', () => {
    expect(supportsInlinePreview('application/pdf')).toBe(true);
    expect(supportsInlinePreview('image/png')).toBe(true);
    expect(supportsInlinePreview('image/svg+xml')).toBe(false);
    expect(supportsInlinePreview('text/csv')).toBe(false);
  });
});
