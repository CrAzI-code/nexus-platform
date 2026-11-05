import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export class CreateProjectDiscussionDto {
  title!: string;
  body!: string;
}

export class ProjectDiscussionMessageDto {
  body!: string;
}

type RequestBody = Record<string, unknown>;

function isRecord(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(value: unknown, allowedKeys: string[]): RequestBody {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new BadRequestException(
      'Provide only supported discussion fields.',
    );
  }
  return value;
}

function readText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} is required.`);
  }
  const text = value.trim();
  if (!text || Array.from(text).length > maximum) {
    throw new BadRequestException(
      `${label} must be between 1 and ${maximum} characters.`,
    );
  }
  return text;
}

@Injectable()
export class CreateProjectDiscussionPipe
  implements PipeTransform<unknown, CreateProjectDiscussionDto>
{
  transform(value: unknown): CreateProjectDiscussionDto {
    const body = readBody(value, ['title', 'body']);
    return {
      title: readText(body.title, 'Discussion title', 160),
      body: readText(body.body, 'Message', 5000),
    };
  }
}

@Injectable()
export class ProjectDiscussionMessagePipe
  implements PipeTransform<unknown, ProjectDiscussionMessageDto>
{
  transform(value: unknown): ProjectDiscussionMessageDto {
    const body = readBody(value, ['body']);
    return { body: readText(body.body, 'Message', 5000) };
  }
}
