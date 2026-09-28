import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export const EXTERNAL_CACHE = Symbol('EXTERNAL_CACHE');

// Wo Antworten externer APIs zwischengespeichert werden. Eigene
// Schnittstelle wie beim ConversationStore: Die Clients wissen nichts von
// Prisma, und Tests nutzen einen Speicher im Arbeitsspeicher.
export interface ExternalCache {
  // undefined = nicht vorhanden oder abgelaufen
  get(key: string): Promise<unknown>;
  set(
    key: string,
    provider: string,
    payload: unknown,
    ttlMs: number,
  ): Promise<void>;
}

// Aufgeräumt wird beim Schreiben statt per Zeitplan: Die API skaliert auf 0,
// ein Timer im Prozess würde dann meist gar nicht laufen. Höchstens einmal pro
// Stunde, damit nicht jeder API-Aufruf eine Löschabfrage auslöst.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class PrismaExternalCache implements ExternalCache {
  private readonly logger = new Logger(PrismaExternalCache.name);
  // Zeitpunkt des letzten Aufräumens (ms seit 1970), 0 = noch nie
  private lastCleanup = 0;
  constructor(private readonly prisma: PrismaService) {}

  // Ein Cache ist eine Abkürzung, keine Voraussetzung: Ist die Datenbank
  // gerade nicht erreichbar, gilt das als Cache-Miss, und die API wird eben
  // direkt gefragt. Deshalb fangen get und set jeden Fehler ab.
  async get(key: string): Promise<unknown> {
    try {
      const entry = await this.prisma.externalApiCache.findUnique({
        where: { key },
      });
      // Abgelaufene Einträge liegen bis zum nächsten Aufräumen noch in der
      // Tabelle, sie dürfen aber nicht mehr ausgeliefert werden.
      if (!entry || entry.expiresAt.getTime() <= Date.now()) return undefined;
      return entry.payload;
    } catch (error) {
      this.logger.warn(`Cache-Lesen fehlgeschlagen: ${error}`);
      return undefined;
    }
  }

  async set(
    key: string,
    provider: string,
    payload: unknown,
    ttlMs: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const json = payload as Prisma.InputJsonValue;
    try {
      await this.prisma.externalApiCache.upsert({
        where: { key },
        create: { key, provider, payload: json, expiresAt },
        update: { provider, payload: json, expiresAt },
      });
    } catch (error) {
      this.logger.warn(`Cache-Schreiben fehlgeschlagen: ${error}`);
    }
    await this.deleteExpired();
  }

  private async deleteExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    // Vor dem await setzen: Kommen zwei Schreibvorgänge gleichzeitig, räumt
    // nur der erste auf.
    this.lastCleanup = now;
    try {
      const { count } = await this.prisma.externalApiCache.deleteMany({
        where: { expiresAt: { lt: new Date(now) } },
      });
      if (count > 0) {
        this.logger.log(`${count} abgelaufene Cache-Einträge gelöscht`);
      }
    } catch (error) {
      this.logger.warn(`Aufräumen des API-Caches fehlgeschlagen: ${error}`);
    }
  }
}

// Speicher im Arbeitsspeicher für Tests und für Aufrufer ohne Nest (z. B.
// Skripte). Gleiche Semantik wie PrismaExternalCache, nur ohne Aufräumen.
export class InMemoryExternalCache implements ExternalCache {
  readonly entries = new Map<
    string,
    { provider: string; payload: unknown; expiresAt: number }
  >();

  get(key: string): Promise<unknown> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(structuredClone(entry.payload));
  }

  set(
    key: string,
    provider: string,
    payload: unknown,
    ttlMs: number,
  ): Promise<void> {
    this.entries.set(key, {
      provider,
      payload: structuredClone(payload),
      expiresAt: Date.now() + ttlMs,
    });
    return Promise.resolve();
  }
}
