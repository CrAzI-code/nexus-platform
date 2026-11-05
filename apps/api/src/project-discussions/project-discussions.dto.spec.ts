import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  CreateProjectDiscussionPipe,
  ProjectDiscussionMessagePipe,
} from './project-discussions.dto.js';

describe('project discussion request validation', () => {
  const createPipe = new CreateProjectDiscussionPipe();
  const messagePipe = new ProjectDiscussionMessagePipe();

  it('trims and validates discussion titles and opening messages', () => {
    expect(
      createPipe.transform({
        title: '  Release plan  ',
        body: '  Ready to ship?  ',
      }),
    ).toEqual({ title: 'Release plan', body: 'Ready to ship?' });
  });

  it('rejects empty or oversized content and unknown fields', () => {
    expect(() => createPipe.transform({ title: '  ', body: 'Message' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      createPipe.transform({
        title: 'x'.repeat(161),
        body: 'Message',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      messagePipe.transform({ body: 'x'.repeat(5001) }),
    ).toThrow(BadRequestException);
    expect(() =>
      messagePipe.transform({ body: 'Message', isAdmin: true }),
    ).toThrow(BadRequestException);
  });
});
