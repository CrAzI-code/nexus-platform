import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

export interface NotificationListQuery {
  page: number;
  pageSize: number;
}

@Injectable()
export class NotificationListPipe
  implements PipeTransform<unknown, NotificationListQuery>
{
  transform(value: unknown): NotificationListQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Invalid notification pagination.');
    }
    const query = value as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'page' && key !== 'pageSize')) {
      throw new BadRequestException('Unsupported notification query parameter.');
    }
    const page = this.readInteger(query.page, 1, 10_000, 'page');
    const pageSize = this.readInteger(query.pageSize, 20, 100, 'pageSize');
    return { page, pageSize };
  }

  private readInteger(
    value: unknown,
    fallback: number,
    maximum: number,
    name: string,
  ): number {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d*$/u.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > maximum
    ) {
      throw new BadRequestException(
        `${name} must be a positive integer no greater than ${maximum}.`,
      );
    }
    return Number(value);
  }
}
