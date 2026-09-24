import { Type, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { StopCategory } from '../generated/prisma/client';

// Obergrenzen gegen beliebig große Bodies: großzügig für echte Reisen,
// aber kein Platz für Megabyte-Payloads oder tausende Programmpunkte.
const MAX_STOPS = 100;
const MAX_BUDGET_CENTS = 100_000_000; // 1 Mio. in der Hauptwährung

@ValidatorConstraint({ name: 'endNotBeforeStart' })
class EndNotBeforeStart implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments) {
    const { startDate } = args.object as CreateItineraryDto;
    const start = new Date(startDate);
    // Ist schon startDate ungültig, meldet das @IsDateString; hier nicht
    // zusätzlich einen verwirrenden Folgefehler für endDate erzeugen.
    if (Number.isNaN(start.getTime())) return true;
    return new Date(endDate) >= start;
  }

  defaultMessage() {
    return 'endDate darf nicht vor startDate liegen';
  }
}

export class ItineraryStopDto {
  @IsInt()
  @Min(1)
  @Max(365)
  dayNumber!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  order!: number;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(StopCategory)
  category?: StopCategory;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BUDGET_CENTS)
  costCents?: number;
}

export class CreateItineraryDto {
  @IsString()
  @Length(1, 100)
  destination!: string;

  // Nur echte Datumsangaben (YYYY-MM-DD oder ISO). Vorher wurde aus
  // new Date("quatsch") ein Prisma-Fehler und damit eine 500.
  @IsDateString()
  startDate!: string;

  @IsDateString()
  @Validate(EndNotBeforeStart)
  endDate!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_BUDGET_CENTS)
  budgetCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  preferences?: string[];

  @IsArray()
  @ArrayMaxSize(MAX_STOPS)
  @ValidateNested({ each: true })
  @Type(() => ItineraryStopDto)
  stops!: ItineraryStopDto[];
}

// Für Aufrufer ohne ValidationPipe (das save_itinerary-Tool des Agenten):
// liefert lesbare Fehlermeldungen oder eine leere Liste.
export function itineraryValidationErrors(input: unknown): string[] {
  const dto = plainToInstance(CreateItineraryDto, input ?? {});
  const collect = (
    errors: ReturnType<typeof validateSync>,
    prefix = '',
  ): string[] =>
    errors.flatMap((e) => [
      ...Object.values(e.constraints ?? {}).map((m) => `${prefix}${m}`),
      ...collect(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return collect(validateSync(dto));
}
