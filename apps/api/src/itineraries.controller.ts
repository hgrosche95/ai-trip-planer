import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Delete,
} from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import type { CreateItineraryInput } from './itineraries.service';

// Kein Login-Zwang mehr: itineraries.service.ts legt ohnehin jeden
// Reiseplan unter demselben festen guest@local.dev-Nutzer an (kein
// Multi-Tenancy), das JWT-Login trennte hier also nie echte Nutzerdaten
// voneinander - es hielt nur anonyme Besucher fern, was jetzt bewusst
// nicht mehr gewollt ist.
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @Post()
  create(@Body() body: CreateItineraryInput) {
    return this.itinerariesService.create(body);
  }

  @Get()
  findAll() {
    return this.itinerariesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itinerariesService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.itinerariesService.remove(id);
  }

  @Delete(':id/stops/:stopId')
  removeStop(@Param('id') id: string, @Param('stopId') stopId: string) {
    return this.itinerariesService.removeStop(id, stopId);
  }
}
