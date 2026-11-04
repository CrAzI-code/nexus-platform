import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuditLogListPipe } from './audit-logs.dto.js';

describe('AuditLogListPipe', () => {
  const pipe = new AuditLogListPipe();

  it('applies defaults and parses supported filters', () => {
    expect(
      pipe.transform({
        action: 'TASK_STATUS_CHANGED',
        actorId: '00000000-0000-4000-8000-000000000001',
        from: '2026-11-01T00:00:00.000Z',
      }),
    ).toEqual({
      page: 1,
      pageSize: 25,
      action: 'TASK_STATUS_CHANGED',
      actorId: '00000000-0000-4000-8000-000000000001',
      from: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it.each(['INVITATION_RESENT', 'INVITATION_DECLINED'] as const)(
    'allows filtering invitation lifecycle action %s',
    (action) => {
      expect(pipe.transform({ action })).toMatchObject({ action });
    },
  );

  it.each([
    { action: 'UNKNOWN' },
    { actorId: 'not-a-uuid' },
    { page: '0' },
    { pageSize: '101' },
    { from: 'not-a-date' },
    { from: '2026-11-03T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
    { extra: 'unsupported' },
  ])('rejects invalid filters: %o', (query) => {
    expect(() => pipe.transform(query)).toThrow(BadRequestException);
  });
});
