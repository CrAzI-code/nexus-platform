import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export class CreateOrganizationDto {
  name!: string;
}

@Injectable()
export class CreateOrganizationPipe
  implements PipeTransform<unknown, CreateOrganizationDto>
{
  transform(value: unknown): CreateOrganizationDto {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'name')
    ) {
      throw new BadRequestException(
        'Provide only an organization name.',
      );
    }

    if (!('name' in value) || typeof value.name !== 'string') {
      throw new BadRequestException('Organization name is required.');
    }

    const normalizedName = value.name.trim();
    if (
      !normalizedName ||
      Array.from(normalizedName).length > 100 ||
      normalizedName
        .split('')
        .some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        })
    ) {
      throw new BadRequestException(
        'Organization name must be between 1 and 100 characters.',
      );
    }

    return { name: normalizedName };
  }
}
