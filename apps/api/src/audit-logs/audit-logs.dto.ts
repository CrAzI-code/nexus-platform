import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type {
  AuditLogAction,
  AuditLogTargetType,
} from '../generated/prisma/client.js';

export interface AuditLogListQuery {
  page: number;
  pageSize: number;
  action?: AuditLogAction;
  actorId?: string;
  targetType?: AuditLogTargetType;
  targetId?: string;
  from?: Date;
  to?: Date;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actions: AuditLogAction[] = [
  'ORGANIZATION_MEMBER_ROLE_CHANGED',
  'ORGANIZATION_MEMBER_REMOVED',
  'INVITATION_CREATED',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_ARCHIVED',
  'PROJECT_RESTORED',
  'PROJECT_MEMBER_ADDED',
  'PROJECT_MEMBER_REMOVED',
  'TASK_ASSIGNED',
  'TASK_UPDATED',
  'TASK_STATUS_CHANGED',
  'TASK_ARCHIVED',
  'TASK_RESTORED',
  'FILE_UPLOADED',
  'FILE_REMOVED',
];

const targetTypes: AuditLogTargetType[] = [
  'ORGANIZATION_MEMBER',
  'INVITATION',
  'PROJECT',
  'PROJECT_MEMBER',
  'TASK',
  'FILE_ATTACHMENT',
];

function isAuditAction(value: string): value is AuditLogAction {
  return actions.some((action) => action === value);
}

function isAuditTargetType(value: string): value is AuditLogTargetType {
  return targetTypes.some((targetType) => targetType === value);
}

function readScalar(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`The ${key} filter must be a single value.`);
  }
  return value;
}

function readUuid(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readScalar(query, key);
  if (value === undefined) return undefined;
  if (!uuidPattern.test(value)) {
    throw new BadRequestException(`The ${key} filter must be a valid UUID.`);
  }
  return value;
}

function readDate(
  query: Record<string, unknown>,
  key: string,
): Date | undefined {
  const value = readScalar(query, key);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(parsed.getTime())
  ) {
    throw new BadRequestException(
      `The ${key} filter must be an ISO 8601 timestamp.`,
    );
  }
  return parsed;
}

function readPage(query: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = readScalar(query, key);
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(`The ${key} filter must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`${key} must be between 1 and ${max}.`);
  }
  return parsed;
}

@Injectable()
export class AuditLogListPipe
  implements PipeTransform<unknown, AuditLogListQuery>
{
  transform(value: unknown): AuditLogListQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Audit log filters must be query values.');
    }

    const query = value as Record<string, unknown>;
    const allowed = new Set([
      'page',
      'pageSize',
      'action',
      'actorId',
      'targetType',
      'targetId',
      'from',
      'to',
    ]);
    if (Object.keys(query).some((key) => !allowed.has(key))) {
      throw new BadRequestException('Unsupported audit log filter.');
    }

    const action = readScalar(query, 'action');
    if (action !== undefined && !isAuditAction(action)) {
      throw new BadRequestException('Choose a supported audit action.');
    }

    const targetType = readScalar(query, 'targetType');
    if (
      targetType !== undefined &&
      !isAuditTargetType(targetType)
    ) {
      throw new BadRequestException('Choose a supported target type.');
    }

    const from = readDate(query, 'from');
    const to = readDate(query, 'to');
    const actorId = readUuid(query, 'actorId');
    const targetId = readUuid(query, 'targetId');
    if (from && to && from > to) {
      throw new BadRequestException('The from date must be before the to date.');
    }

    return {
      page: readPage(query, 'page', 1, 10_000),
      pageSize: readPage(query, 'pageSize', 25, 100),
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }
}
