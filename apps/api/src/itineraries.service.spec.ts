import { NotFoundException } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import type { PrismaService } from './prisma.service';

describe('ItinerariesService: Mandantentrennung', () => {
  let prisma: {
    itinerary: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
    };
    itineraryStop: { deleteMany: jest.Mock };
  };
  let service: ItinerariesService;

  beforeEach(() => {
    prisma = {
      itinerary: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
      itineraryStop: { deleteMany: jest.fn() },
    };
    service = new ItinerariesService(prisma as unknown as PrismaService);
  });

  it('listet nur die Pläne des anfragenden Nutzers', async () => {
    await service.findAll('user-a');
    expect(prisma.itinerary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } }),
    );
  });

  it('behandelt einen fremden Plan beim Lesen als nicht gefunden', async () => {
    prisma.itinerary.findFirst.mockResolvedValue(null);

    await expect(service.findOne('user-a', 'plan-von-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.itinerary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'plan-von-b', userId: 'user-a' },
      }),
    );
  });

  it('löscht nur eigene Pläne, ein fremder Plan ist "nicht gefunden"', async () => {
    prisma.itinerary.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('user-a', 'plan-von-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.itinerary.deleteMany).toHaveBeenCalledWith({
      where: { id: 'plan-von-b', userId: 'user-a' },
    });
  });

  it('prüft beim Löschen eines Programmpunkts den Besitzer des Plans', async () => {
    prisma.itineraryStop.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.removeStop('user-a', 'plan-1', 'stop-1'),
    ).resolves.toEqual({ deleted: true });
    expect(prisma.itineraryStop.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'stop-1',
        itineraryId: 'plan-1',
        itinerary: { userId: 'user-a' },
      },
    });
  });
});
