import { Module } from '@nestjs/common';
import { BrevoEmailService } from './brevo-email.service.js';

@Module({
  providers: [BrevoEmailService],
  exports: [BrevoEmailService],
})
export class EmailModule {}
