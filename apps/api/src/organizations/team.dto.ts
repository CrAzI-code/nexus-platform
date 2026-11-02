import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { InvitationRole, OrganizationRole } from '../generated/prisma/client.js';

export class CreateInvitationDto {
  email!: string;
  role!: InvitationRole;
}

export class AcceptInvitationDto {
  token!: string;
}

export class UpdateMemberRoleDto {
  role!: Exclude<OrganizationRole, 'OWNER'>;
}

type RequestBody = Record<string, unknown>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const invitationRoles = ['ADMIN', 'MANAGER', 'MEMBER'] as const;
const memberRoles = ['ADMIN', 'MANAGER', 'MEMBER'] as const;

function readBody(value: unknown, allowedKeys: string[]): RequestBody {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new BadRequestException('Provide only supported team fields.');
  }
  return value;
}

function isRecord(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('A valid email address is required.');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return email;
}

function readRole<T extends string>(
  value: unknown,
  roles: readonly T[],
): T {
  const role = roles.find((candidate) => candidate === value);
  if (!role) {
    throw new BadRequestException('Choose a valid organization role.');
  }
  return role;
}

@Injectable()
export class CreateInvitationPipe
  implements PipeTransform<unknown, CreateInvitationDto>
{
  transform(value: unknown): CreateInvitationDto {
    const body = readBody(value, ['email', 'role']);
    return {
      email: readEmail(body.email),
      role: 'role' in body
        ? readRole(body.role, invitationRoles)
        : 'MEMBER',
    };
  }
}

@Injectable()
export class AcceptInvitationPipe
  implements PipeTransform<unknown, AcceptInvitationDto>
{
  transform(value: unknown): AcceptInvitationDto {
    const body = readBody(value, ['token']);
    if (
      typeof body.token !== 'string' ||
      !/^[a-f0-9]{64}$/iu.test(body.token)
    ) {
      throw new BadRequestException('This invitation link is invalid.');
    }
    return { token: body.token };
  }
}

@Injectable()
export class UpdateMemberRolePipe
  implements PipeTransform<unknown, UpdateMemberRoleDto>
{
  transform(value: unknown): UpdateMemberRoleDto {
    const body = readBody(value, ['role']);
    return { role: readRole(body.role, memberRoles) };
  }
}
