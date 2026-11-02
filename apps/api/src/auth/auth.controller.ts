import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(ClerkAuthGuard)
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
