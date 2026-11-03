import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma.service.js';

describe('AppController', () => {
  let appController: AppController;
  const prisma = {
    user: {
      count: vi.fn(),
    },
  };

  beforeEach(async () => {
    prisma.user.count.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('database health', () => {
    it('returns the database status without exposing record counts', async () => {
      prisma.user.count.mockResolvedValue(3);

      await expect(appController.getDatabaseHealth()).resolves.toEqual({
        status: 'ok',
        database: 'connected',
      });
    });

    it('returns a generic service-unavailable error when the database query fails', async () => {
      prisma.user.count.mockRejectedValue(
        new Error('Sensitive database connection details'),
      );

      await expect(appController.getDatabaseHealth()).rejects.toThrow(
        new ServiceUnavailableException('Database health check failed'),
      );
    });
  });
});
