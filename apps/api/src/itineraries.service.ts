import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, StopCategory } from '../generated/prisma/client';
import * as appInsights from 'applicationinsights';

export interface CreateItineraryInput {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency?: string;
  preferences?: string[];
  // Eckdaten aus dem Entwurf, für "Im Chat bearbeiten"
  travelers?: number;
  origin?: string;
  lodging?: 'budget' | 'mid' | 'upscale';
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description?: string;
    category?: StopCategory;
    costCents?: number;
    lat?: number;
    lng?: number;
  }[];
  // Nur beim Speichern eines Entwurfs aus dem Chat
  budgetReport?: {
    currency: string;
    limitCents: number | null;
    totalCents: number;
    status: 'ok' | 'tight' | 'over';
    items: { category: string; cents: number }[];
  };
  assumptions?: string[];
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
        ...itineraryFields(input),
        userId,
        stops: { create: stopRows(input) },
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

  // Ersetzt eine Reise vollständig durch einen überarbeiteten Entwurf
  // ("Im Chat bearbeiten" → "Änderungen speichern"). Alle Stopps werden neu
  // angelegt: Ein Entwurf kennt keine Stop-IDs, und Tage können wegfallen.
  // Besitzprüfung, Löschen und Anlegen in einer Transaktion, damit nie eine
  // halb ersetzte Reise stehen bleibt.
  async update(userId: string, id: string, input: CreateItineraryInput) {
    const itinerary = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.itinerary.updateMany({
        where: { id, userId },
        data: itineraryFields(input),
      });
      if (count === 0) {
        throw new NotFoundException(`Reiseplan ${id} nicht gefunden`);
      }
      await tx.itineraryStop.deleteMany({ where: { itineraryId: id } });
      await tx.itineraryStop.createMany({
        data: stopRows(input).map((stop) => ({ ...stop, itineraryId: id })),
      });
      return tx.itinerary.findUniqueOrThrow({
        where: { id },
        include: {
          stops: { orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }] },
        },
      });
    });

    appInsights.defaultClient?.trackEvent({
      name: 'ItineraryUpdated',
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

// Spalten einer Reise aus dem Body, gleich für Anlegen und Ersetzen. Beim
// Ersetzen werden fehlende Eckdaten zu null statt stehen zu bleiben.
function itineraryFields(input: CreateItineraryInput) {
  return {
    destination: input.destination,
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    budgetCents: input.budgetCents,
    currency: input.currency ?? 'EUR',
    preferences: input.preferences ?? [],
    budgetReport: input.budgetReport ?? Prisma.DbNull,
    assumptions: input.assumptions ?? [],
    travelers: input.travelers ?? null,
    origin: input.origin ?? null,
    lodging: input.lodging ?? null,
  };
}

function stopRows(input: CreateItineraryInput) {
  return input.stops.map((s) => ({
    dayNumber: s.dayNumber,
    order: s.order,
    title: s.title,
    description: s.description,
    category: s.category ?? 'OTHER',
    costCents: s.costCents,
    lat: s.lat,
    lng: s.lng,
  }));
}
