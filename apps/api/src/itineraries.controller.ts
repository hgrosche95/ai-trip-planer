import { Controller, Get, Param, Delete } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';

@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

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
