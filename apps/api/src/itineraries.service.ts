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
}
