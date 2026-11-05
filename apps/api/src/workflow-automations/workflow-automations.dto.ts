import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type {
  TaskPriority,
  TaskStatus,
  WorkflowAutomationAction,
  WorkflowAutomationTrigger,
} from '../generated/prisma/client.js';

export class SaveWorkflowAutomationDto {
  name!: string;
  trigger!: WorkflowAutomationTrigger;
  conditionPriority?: TaskPriority | null;
  conditionStatus?: TaskStatus | null;
  conditionAssigneeId?: string | null;
  action!: WorkflowAutomationAction;
  actionValue?: string | null;
  actionAssigneeId?: string | null;
}

export class SetWorkflowAutomationEnabledDto {
  enabled!: boolean;
}

const triggers = [
  'TASK_CREATED',
  'TASK_STATUS_CHANGED',
  'TASK_ASSIGNED',
  'TASK_DUE_DATE_APPROACHING',
  'TASK_OVERDUE',
  'TASK_BLOCKER_REPORTED',
  'TASK_BLOCKER_RESOLVED',
] as const;
const actions = [
  'SEND_NOTIFICATION',
  'CHANGE_STATUS',
  'ASSIGN_MEMBER',
] as const;
const statuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
const automationTargetStatuses = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.some((item) => item === value)) {
    throw new BadRequestException(`Choose a valid ${label}.`);
  }
  return value as T;
}

@Injectable()
export class SaveWorkflowAutomationPipe
  implements PipeTransform<unknown, SaveWorkflowAutomationDto>
{
  transform(value: unknown): SaveWorkflowAutomationDto {
    const allowedKeys = [
      'name',
      'trigger',
      'conditionPriority',
      'conditionStatus',
      'conditionAssigneeId',
      'action',
      'actionValue',
      'actionAssigneeId',
    ];
    if (
      !isRecord(value) ||
      Object.keys(value).some((key) => !allowedKeys.includes(key))
    ) {
      throw new BadRequestException(
        'Provide only supported automation rule fields.',
      );
    }

    const name =
      typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || Array.from(name).length > 120) {
      throw new BadRequestException(
        'Automation name must be between 1 and 120 characters.',
      );
    }
    if (
      typeof value.trigger !== 'string' ||
      !triggers.some((item) => item === value.trigger)
    ) {
      throw new BadRequestException('Choose a valid automation trigger.');
    }
    if (
      typeof value.action !== 'string' ||
      !actions.some((item) => item === value.action)
    ) {
      throw new BadRequestException('Choose a valid automation action.');
    }

    const conditionPriority = optionalEnum(
      value.conditionPriority,
      priorities,
      'priority condition',
    );
    const conditionStatus = optionalEnum(
      value.conditionStatus,
      statuses,
      'status condition',
    );
    const conditionAssigneeId = this.readOptionalUserId(
      value.conditionAssigneeId,
      'condition assignee',
    );
    const actionAssigneeId = this.readOptionalUserId(
      value.actionAssigneeId,
      'action assignee',
    );
    let actionValue: string | null = null;
    if (value.action === 'SEND_NOTIFICATION') {
      if (typeof value.actionValue !== 'string') {
        throw new BadRequestException(
          'Add a message for the notification action.',
        );
      }
      actionValue = value.actionValue.trim();
      if (!actionValue || Array.from(actionValue).length > 500) {
        throw new BadRequestException(
          'Notification message must be between 1 and 500 characters.',
        );
      }
      if (actionAssigneeId) {
        throw new BadRequestException(
          'A notification action cannot include an assignee.',
        );
      }
    } else if (value.action === 'CHANGE_STATUS') {
      actionValue = optionalEnum(
        value.actionValue,
        automationTargetStatuses,
        'task status other than BLOCKED',
      );
      if (!actionValue || actionAssigneeId) {
        throw new BadRequestException(
          'Choose one task status for the status-change action.',
        );
      }
    } else if (!actionAssigneeId || value.actionValue != null) {
      throw new BadRequestException(
        'Choose one project member for the assignment action.',
      );
    }

    return {
      name,
      trigger: value.trigger as WorkflowAutomationTrigger,
      conditionPriority,
      conditionStatus,
      conditionAssigneeId,
      action: value.action as WorkflowAutomationAction,
      actionValue,
      actionAssigneeId,
    };
  }

  private readOptionalUserId(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !uuidPattern.test(value)) {
      throw new BadRequestException(`Choose a valid ${label}.`);
    }
    return value;
  }
}

@Injectable()
export class SetWorkflowAutomationEnabledPipe
  implements PipeTransform<unknown, SetWorkflowAutomationEnabledDto>
{
  transform(value: unknown): SetWorkflowAutomationEnabledDto {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.enabled !== 'boolean'
    ) {
      throw new BadRequestException(
        'Choose whether this automation is enabled.',
      );
    }
    return { enabled: value.enabled };
  }
}
