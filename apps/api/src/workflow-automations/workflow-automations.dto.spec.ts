import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SaveWorkflowAutomationPipe } from './workflow-automations.dto.js';

describe('SaveWorkflowAutomationPipe', () => {
  const pipe = new SaveWorkflowAutomationPipe();

  it('normalizes names and notification messages while preserving conditions', () => {
    expect(
      pipe.transform({
        name: '  Notify urgent work  ',
        trigger: 'TASK_CREATED',
        conditionPriority: 'URGENT',
        conditionStatus: 'BLOCKED',
        action: 'SEND_NOTIFICATION',
        actionValue: '  Please review this task.  ',
      }),
    ).toMatchObject({
      name: 'Notify urgent work',
      conditionPriority: 'URGENT',
      conditionStatus: 'BLOCKED',
      action: 'SEND_NOTIFICATION',
      actionValue: 'Please review this task.',
      actionAssigneeId: null,
    });
  });

  it('rejects blocked status actions because they require a blocker reason', () => {
    expect(() =>
      pipe.transform({
        name: 'Block task',
        trigger: 'TASK_CREATED',
        action: 'CHANGE_STATUS',
        actionValue: 'BLOCKED',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects fields outside the supported rule contract', () => {
    expect(() =>
      pipe.transform({
        name: 'Notify',
        trigger: 'TASK_CREATED',
        action: 'SEND_NOTIFICATION',
        actionValue: 'Review task.',
        organizationId: 'another-organization',
      }),
    ).toThrow(BadRequestException);
  });
});