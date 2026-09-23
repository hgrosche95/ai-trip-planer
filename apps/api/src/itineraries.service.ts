import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { StopCategory } from '../generated/prisma/client';
import * as appInsights from 'applicationinsights';

export interface CreateItineraryInput {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency?: string;
  preferences?: string[];
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description?: string;
    category?: StopCategory;
    costCents?: number;
  }[];
}

@Injectable()
export class ItinerariesService {
  constructor(private readonly prisma: PrismaService) {}

  // Einzige Stelle, die einen Reiseplan tatsächlich anlegt - Chat-Agent
  // (save_itinerary-Tool), POST-Endpunkt und MCP-Server (über REST) laufen
  // alle hierüber, damit die Prisma-Logik nur einmal existiert.
  // Jede Methode bekommt die userId aus dem Token und arbeitet nur auf
  // dessen Plänen: fremde Pläne sind für alle Aufrufer "nicht gefunden".
  async create(userId: string, input: CreateItineraryInput) {
    const itinerary = await this.prisma.itinerary.create({
      data: {
        destination: input.destination,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        budgetCents: input.budgetCents,
        currency: input.currency ?? 'EUR',
        preferences: input.preferences ?? [],
        userId,
        stops: {
          create: input.stops.map((s) => ({
            dayNumber: s.dayNumber,
            order: s.order,
            title: s.title,
            description: s.description,
            category: s.category ?? 'OTHER',
            costCents: s.costCents,
          })),
        },
      },
      include: { stops: true },
    });

    appInsights.defaultClient?.trackEvent({
      name: 'ItinerarySaved',
      properties: {
        destination: input.destination,
        stopCount: String(input.stops.length),
      },
    });

    return itinerary;
  }

  findAll(userId: string) {
    return this.prisma.itinerary.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const itinerary = await this.prisma.itinerary.findFirst({
      where: { id, userId },
      include: {
        stops: { orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }] },
      },
    });

    if (!itinerary) {
      throw new NotFoundException(`Reiseplan ${id} nicht gefunden`);
    }

    return itinerary;
  }

  // deleteMany mit userId im Filter statt findUnique + delete: Besitzprüfung
  // und Löschen sind eine einzige Abfrage, dazwischen kann nichts passieren.
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.itinerary.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException(`Reiseplan ${id} nicht gefunden`);
    }
    return { deleted: true };
  }

  async removeStop(userId: string, itineraryId: string, stopId: string) {
    const { count } = await this.prisma.itineraryStop.deleteMany({
      where: { id: stopId, itineraryId, itinerary: { userId } },
    });
    if (count === 0) {
      throw new NotFoundException(`Programmpunkt ${stopId} nicht gefunden`);
    }
    return { deleted: true };
  }
}
