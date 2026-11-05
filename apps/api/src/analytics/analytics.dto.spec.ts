import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AnalyticsQueryPipe } from './analytics.dto.js';

describe('AnalyticsQueryPipe', () => {
  const pipe = new AnalyticsQueryPipe();

  it('defaults to a 30 day range and accepts supported filters', () => {
    expect(pipe.transform({ days: '90', status: 'BLOCKED' })).toEqual({
      days: 90,
      status: 'BLOCKED',
      projectId: undefined,
    });
    expect(pipe.transform({})).toEqual({ days: 30, projectId: undefined, status: undefined });
  });

  it('rejects invalid ranges, statuses, project IDs, and extra query fields', () => {
    for (const query of [
      { days: '365' },
      { status: 'CANCELLED' },
      { projectId: 'not-a-uuid' },
      { role: 'OWNER' },
    ]) {
      expect(() => pipe.transform(query)).toThrow(BadRequestException);
    }
  });
});