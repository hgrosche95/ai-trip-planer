import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { warmUpRag } from './rag-client';

jest.mock('./rag-client', () => ({ warmUpRag: jest.fn() }));

describe('HealthController', () => {
  let healthController: HealthController;
  let healthService: { checkDatabase: jest.Mock };

  beforeEach(async () => {
    healthService = { checkDatabase: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    healthController = app.get<HealthController>(HealthController);
  });

  it('returns status ok when the database is reachable', async () => {
    healthService.checkDatabase.mockResolvedValue(true);

    await expect(healthController.check()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('returns status error when the database is unreachable', async () => {
    healthService.checkDatabase.mockResolvedValue(false);

    await expect(healthController.check()).resolves.toEqual({
      status: 'error',
      database: 'unreachable',
    });
  });

  it('weckt den RAG-Service über /health/warmup', () => {
    jest.mocked(warmUpRag).mockReturnValue(true);

    expect(healthController.warmUp()).toEqual({ rag: 'waking' });
    expect(warmUpRag).toHaveBeenCalled();
  });
});
