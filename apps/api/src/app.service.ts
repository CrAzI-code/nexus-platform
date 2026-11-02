import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getDatabaseHealth(): Promise<{
    status: 'ok';
    database: 'connected';
    users: number;
  }> {
    try {
      const users = await this.prisma.user.count();
      return { status: 'ok', database: 'connected', users };
    } catch {
      throw new ServiceUnavailableException('Database health check failed');
    }
  }
}
