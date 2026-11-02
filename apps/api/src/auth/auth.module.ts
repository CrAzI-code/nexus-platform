import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { AuthController } from './auth.controller.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { ClerkAuthService } from './clerk-auth.service.js';
import { ClerkBackendService } from './clerk-backend.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    ClerkAuthGuard,
    ClerkAuthService,
    ClerkBackendService,
    UserProvisioningService,
  ],
  exports: [ClerkAuthGuard, ClerkAuthService],
})
export class AuthModule {}
