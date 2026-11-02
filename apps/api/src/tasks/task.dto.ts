import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { TaskPriority, TaskStatus } from '../generated/prisma/client.js';

export class CreateTaskDto {
  title!: string;
  description?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
}

export class UpdateTaskDto {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
}

export class ChangeTaskStatusDto {
  status!: TaskStatus;
  blockerReason?: string;
}

export class AssignTaskDto {
  assigneeId!: string | null;
}

export class CreateTaskCommentDto {
  body!: string;
}

type RequestBody = Record<string, unknown>;

function isTaskStatus(value: unknown): value is TaskStatus {
  return taskStatuses.some((status) => status === value);
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return taskPriorities.some((priority) => priority === value);
}

const taskStatuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
const taskPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(value: unknown, allowedKeys: string[]): RequestBody {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new BadRequestException('Provide only supported task fields.');
  }
  return value;
}

function readTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Task title is required.');
  }
  const title = value.trim();
  if (!title || Array.from(title).length > 200) {
    throw new BadRequestException(
      'Task title must be between 1 and 200 characters.',
    );
  }
  return title;
}

function readDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('Task description must be text or null.');
  }
  const description = value.trim();
  if (Array.from(description).length > 5000) {
    throw new BadRequestException(
      'Task description must be 5000 characters or fewer.',
    );
  }
  return description || null;
}

function readPriority(value: unknown): TaskPriority {
  if (!isTaskPriority(value)) {
    throw new BadRequestException('Choose a valid task priority.');
  }
  return value;
}

function readDueAt(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      'Due date must be a valid calendar date or null.',
    );
  }
  return value;
}

@Injectable()
export class CreateTaskPipe implements PipeTransform<unknown, CreateTaskDto> {
  transform(value: unknown): CreateTaskDto {
    const body = readBody(value, ['title', 'description', 'priority', 'dueAt']);
    const task: CreateTaskDto = { title: readTitle(body.title) };
    if ('description' in body) task.description = readDescription(body.description);
    if ('priority' in body) task.priority = readPriority(body.priority);
    if ('dueAt' in body) task.dueAt = readDueAt(body.dueAt);
    return task;
  }
}

@Injectable()
export class UpdateTaskPipe implements PipeTransform<unknown, UpdateTaskDto> {
  transform(value: unknown): UpdateTaskDto {
    const body = readBody(value, ['title', 'description', 'priority', 'dueAt']);
    if (Object.keys(body).length === 0) {
      throw new BadRequestException('Provide at least one task field to update.');
    }

    const task: UpdateTaskDto = {};
    if ('title' in body) task.title = readTitle(body.title);
    if ('description' in body) {
      task.description = readDescription(body.description);
    }
    if ('priority' in body) task.priority = readPriority(body.priority);
    if ('dueAt' in body) task.dueAt = readDueAt(body.dueAt);
    return task;
  }
}

@Injectable()
export class ChangeTaskStatusPipe
  implements PipeTransform<unknown, ChangeTaskStatusDto>
{
  transform(value: unknown): ChangeTaskStatusDto {
    const body = readBody(value, ['status', 'blockerReason']);
    if (!isTaskStatus(body.status)) {
      throw new BadRequestException('Choose a valid task status.');
    }

    const status = body.status;
    const result: ChangeTaskStatusDto = { status };
    if ('blockerReason' in body) {
      if (typeof body.blockerReason !== 'string') {
        throw new BadRequestException('Blocker details must be text.');
      }
      const reason = body.blockerReason.trim();
      if (!reason || Array.from(reason).length > 2000) {
        throw new BadRequestException(
          'Provide blocker details of no more than 2000 characters.',
        );
      }
      result.blockerReason = reason;
    }
    if (status === 'BLOCKED' && !result.blockerReason) {
      throw new BadRequestException(
        'Provide a blocker reason when setting a task to blocked.',
      );
    }
    if (status !== 'BLOCKED' && 'blockerReason' in body) {
      throw new BadRequestException(
        'Blocker details can only be provided when setting a task to blocked.',
      );
    }
    return result;
  }
}

@Injectable()
export class AssignTaskPipe implements PipeTransform<unknown, AssignTaskDto> {
  transform(value: unknown): AssignTaskDto {
    const body = readBody(value, ['assigneeId']);
    if (
      body.assigneeId !== null &&
      (typeof body.assigneeId !== 'string' || !uuidPattern.test(body.assigneeId))
    ) {
      throw new BadRequestException('Assignee must be a valid user ID or null.');
    }
    if (!('assigneeId' in body)) {
      throw new BadRequestException('Provide an assignee ID or null.');
    }
    return { assigneeId: body.assigneeId as string | null };
  }
}

@Injectable()
export class CreateTaskCommentPipe
  implements PipeTransform<unknown, CreateTaskCommentDto>
{
  transform(value: unknown): CreateTaskCommentDto {
    const body = readBody(value, ['body']);
    if (typeof body.body !== 'string') {
      throw new BadRequestException('Comment text is required.');
    }
    const comment = body.body.trim();
    if (!comment || Array.from(comment).length > 5000) {
      throw new BadRequestException(
        'Comment must be between 1 and 5000 characters.',
      );
    }
    return { body: comment };
  }
}
