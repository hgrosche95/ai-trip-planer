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

  // Einzige Stelle, die einen Reiseplan tatsächlich anlegt - wird sowohl vom
  // Chat-Agenten (save_itinerary-Tool) als auch vom POST-Endpunkt unten und
  // vom MCP-Server (Phase 5) aufgerufen. Ohne dieses Zusammenführen hätte
  // jeder der drei Aufrufer dieselbe Prisma-Logik doppelt (Phase 5 verlangt
  // explizit, keine Geschäftslogik zu duplizieren).
  async create(input: CreateItineraryInput) {
    const user = await this.prisma.user.upsert({
      where: { email: 'guest@local.dev' },
      update: {},
      create: { email: 'guest@local.dev' },
    });

    const itinerary = await this.prisma.itinerary.create({
      data: {
        destination: input.destination,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        budgetCents: input.budgetCents,
        currency: input.currency ?? 'EUR',
        preferences: input.preferences ?? [],
        userId: user.id,
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
