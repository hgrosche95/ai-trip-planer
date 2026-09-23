import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import type { CreateItineraryInput } from './itineraries.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from './auth/current-user';

// Jeder Besucher hat ein Token (Gäste bekommen es automatisch über
// /auth/guest) und sieht bzw. löscht nur seine eigenen Reisepläne.
@Controller('itineraries')
@UseGuards(JwtAuthGuard)
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateItineraryInput) {
    return this.itinerariesService.create(user.userId, body);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.itinerariesService.findAll(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itinerariesService.findOne(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itinerariesService.remove(user.userId, id);
  }

  @Delete(':id/stops/:stopId')
  removeStop(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stopId') stopId: string,
  ) {
    return this.itinerariesService.removeStop(user.userId, id, stopId);
  }
}
