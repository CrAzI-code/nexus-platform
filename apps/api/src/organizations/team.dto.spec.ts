import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateInvitationPipe } from './team.dto.js';

describe('CreateInvitationPipe', () => {
  const pipe = new CreateInvitationPipe();

  it.each([
    'member..name@example.com',
    '.member@example.com',
    'member.@example.com',
    'member@example..com',
    'member@.example.com',
    'member@example.com.',
  ])('rejects malformed email address %s', (email) => {
    expect(() => pipe.transform({ email, role: 'MEMBER' })).toThrow(
      BadRequestException,
    );
  });

  it('normalizes a valid email address and defaults the role to Member', () => {
    expect(
      pipe.transform({ email: ' New.Member@Example.com ' }),
    ).toEqual({
      email: 'new.member@example.com',
      role: 'MEMBER',
    });
  });
});
