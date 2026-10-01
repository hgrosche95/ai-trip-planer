import { NotFoundException } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import type { PrismaService } from './prisma.service';

describe('ItinerariesService: Mandantentrennung', () => {
  let prisma: {
    itinerary: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    itineraryStop: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: ItinerariesService;

  beforeEach(() => {
    prisma = {
      itinerary: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      itineraryStop: { deleteMany: jest.fn(), createMany: jest.fn() },
      // Transaktion wie bei Prisma: der Callback bekommt den Client
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
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

  const body = {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    travelers: 2,
    stops: [
      { dayNumber: 1, order: 1, title: 'Alfama', lat: 38.71, lng: -9.13 },
      { dayNumber: 2, order: 1, title: 'Belém' },
    ],
  };

  it('ersetzt beim Bearbeiten nur eigene Pläne, ein fremder ist "nicht gefunden"', async () => {
    prisma.itinerary.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('user-b', 'plan-1', body)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.itinerary.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'plan-1', userId: 'user-b' } }),
    );
    expect(prisma.itineraryStop.deleteMany).not.toHaveBeenCalled();
    expect(prisma.itineraryStop.createMany).not.toHaveBeenCalled();
  });

  it('ersetzt Eckdaten und alle Programmpunkte in einer Transaktion', async () => {
    prisma.itinerary.updateMany.mockResolvedValue({ count: 1 });
    await service.update('user-a', 'plan-1', body);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.itinerary.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-1', userId: 'user-a' },
      data: expect.objectContaining({
        destination: 'Lissabon',
        travelers: 2,
        // Nicht mehr genannte Eckdaten werden geleert
        origin: null,
        lodging: null,
        assumptions: [],
      }) as unknown,
    });
    expect(prisma.itineraryStop.deleteMany).toHaveBeenCalledWith({
      where: { itineraryId: 'plan-1' },
    });
    expect(prisma.itineraryStop.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          itineraryId: 'plan-1',
          dayNumber: 1,
          title: 'Alfama',
          category: 'OTHER',
        }),
        expect.objectContaining({ itineraryId: 'plan-1', title: 'Belém' }),
      ],
    });
  });
});
