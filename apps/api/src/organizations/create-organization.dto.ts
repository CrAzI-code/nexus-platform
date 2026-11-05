import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export class CreateOrganizationDto {
  name!: string;
}

export class UpdateOrganizationNameDto {
  name!: string;
}

@Injectable()
export class CreateOrganizationPipe implements PipeTransform<
  unknown,
  CreateOrganizationDto
> {
  transform(value: unknown): CreateOrganizationDto {
    return { name: validateOrganizationName(value) };
  }
}

@Injectable()
export class UpdateOrganizationNamePipe implements PipeTransform<
  unknown,
  UpdateOrganizationNameDto
> {
  transform(value: unknown): UpdateOrganizationNameDto {
    return { name: validateOrganizationName(value) };
  }
}

function validateOrganizationName(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'name')
  ) {
    throw new BadRequestException('Provide only an organization name.');
  }

  if (!('name' in value) || typeof value.name !== 'string') {
    throw new BadRequestException('Organization name is required.');
  }

  const normalizedName = value.name.trim();
  if (
    !normalizedName ||
    Array.from(normalizedName).length > 100 ||
    /\p{Cc}/u.test(normalizedName)
  ) {
    throw new BadRequestException(
      'Organization name must be between 1 and 100 characters.',
    );
  }

  return normalizedName;
}
