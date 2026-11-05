import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  CreateOrganizationPipe,
  UpdateOrganizationNamePipe,
} from './create-organization.dto.js';

describe('organization name validation', () => {
  const createPipe = new CreateOrganizationPipe();
  const updatePipe = new UpdateOrganizationNamePipe();

  it('trims valid names for both create and update operations', () => {
    expect(createPipe.transform({ name: '  NEXUS Team  ' })).toEqual({
      name: 'NEXUS Team',
    });
    expect(updatePipe.transform({ name: '  NEXUS Team  ' })).toEqual({
      name: 'NEXUS Team',
    });
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    const hundredCharacters = '😀'.repeat(100);
    expect(updatePipe.transform({ name: hundredCharacters })).toEqual({
      name: hundredCharacters,
    });
    expect(() =>
      updatePipe.transform({ name: '😀'.repeat(101) }),
    ).toThrow(BadRequestException);
  });

  it('rejects empty, overlong, control-character, and extra fields', () => {
    for (const value of [
      { name: '  ' },
      { name: 'x'.repeat(101) },
      { name: 'invalid\nname' },
      { name: 'invalid\u0085name' },
      { name: 'Valid name', slug: 'untrusted-slug' },
      null,
    ]) {
      expect(() => updatePipe.transform(value)).toThrow(BadRequestException);
    }
  });
});
