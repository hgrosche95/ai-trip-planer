import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class ItinerariesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.itinerary.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const itinerary = await this.prisma.itinerary.findUnique({
      where: { id },
      include: {
        stops: { orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }] },
      },
    });

    if (!itinerary) {
      throw new NotFoundException(`Reiseplan ${id} nicht gefunden`);
    }

    return itinerary;
  }

  async remove(id: string) {
    const itinerary = await this.prisma.itinerary.findUnique({ where: { id } });
    if (!itinerary) {
      throw new NotFoundException(`Reiseplan ${id} nicht gefunden`);
    }
    await this.prisma.itinerary.delete({ where: { id } });
    return { deleted: true };
  }

  async removeStop(itineraryId: string, stopId: string) {
    const stop = await this.prisma.itineraryStop.findUnique({
      where: { id: stopId },
    });
    if (!stop || stop.itineraryId !== itineraryId) {
      throw new NotFoundException(`Programmpunkt ${stopId} nicht gefunden`);
    }
    await this.prisma.itineraryStop.delete({ where: { id: stopId } });
    return { deleted: true };
  }
}
