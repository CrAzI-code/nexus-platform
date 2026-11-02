import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export class CreateProjectDto {
  name!: string;
  description?: string | null;
}

export class UpdateProjectDto {
  name?: string;
  description?: string | null;
}

type ProjectBody = Record<string, unknown>;

function isRecord(value: unknown): value is ProjectBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(value: unknown, allowedKeys: string[]): ProjectBody {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new BadRequestException('Provide only supported project fields.');
  }
  return value;
}

function readName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Project name is required.');
  }
  const name = value.trim();
  if (!name || Array.from(name).length > 100) {
    throw new BadRequestException(
      'Project name must be between 1 and 100 characters.',
    );
  }
  return name;
}

function readDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(
      'Project description must be text or null.',
    );
  }
  const description = value.trim();
  if (Array.from(description).length > 2000) {
    throw new BadRequestException(
      'Project description must be 2000 characters or fewer.',
    );
  }
  return description || null;
}

@Injectable()
export class CreateProjectPipe
  implements PipeTransform<unknown, CreateProjectDto>
{
  transform(value: unknown): CreateProjectDto {
    const body = readBody(value, ['name', 'description']);
    const project: CreateProjectDto = { name: readName(body.name) };

    if ('description' in body) {
      project.description = readDescription(body.description);
    }

    return project;
  }
}

@Injectable()
export class UpdateProjectPipe
  implements PipeTransform<unknown, UpdateProjectDto>
{
  transform(value: unknown): UpdateProjectDto {
    const body = readBody(value, ['name', 'description']);
    if (!('name' in body) && !('description' in body)) {
      throw new BadRequestException(
        'Provide a project name or description to update.',
      );
    }

    const project: UpdateProjectDto = {};
    if ('name' in body) {
      project.name = readName(body.name);
    }
    if ('description' in body) {
      project.description = readDescription(body.description);
    }
    return project;
  }
}
