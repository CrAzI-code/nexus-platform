import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { TaskStatus } from '../generated/prisma/client.js';

export type AnalyticsDays = 7 | 30 | 90;

export type AnalyticsQuery = {
  days: AnalyticsDays;
  projectId?: string;
  status?: TaskStatus;
};

const statuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AnalyticsQueryPipe implements PipeTransform<unknown, AnalyticsQuery> {
  transform(value: unknown): AnalyticsQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Choose valid analytics filters.');
    }

    const query = value as Record<string, unknown>;
    if (Object.keys(query).some((key) => !['days', 'projectId', 'status'].includes(key))) {
      throw new BadRequestException('Choose valid analytics filters.');
    }

    const daysValue = query.days ?? '30';
    if (typeof daysValue !== 'string' || !['7', '30', '90'].includes(daysValue)) {
      throw new BadRequestException('Choose a 7, 30, or 90 day range.');
    }

    let projectId: string | undefined;
    if (query.projectId !== undefined && query.projectId !== '') {
      if (typeof query.projectId !== 'string' || !uuidPattern.test(query.projectId)) {
        throw new BadRequestException('Choose a valid project.');
      }
      projectId = query.projectId;
    }

    let status: TaskStatus | undefined;
    if (query.status !== undefined && query.status !== '') {
      if (typeof query.status !== 'string' || !statuses.some((item) => item === query.status)) {
        throw new BadRequestException('Choose a valid task status.');
      }
      status = query.status as TaskStatus;
    }

    return { days: Number(daysValue) as AnalyticsDays, projectId, status };
  }
}