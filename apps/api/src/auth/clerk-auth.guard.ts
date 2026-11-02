import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { ClerkAuthService } from './clerk-auth.service.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly clerkAuth: ClerkAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.get('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (!match) {
      throw new UnauthorizedException('A bearer session token is required.');
    }

    const user = await this.clerkAuth.authenticate(match[1]);
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account is not active.');
    }

    request.authenticatedUser = user;
    return true;
  }
}
