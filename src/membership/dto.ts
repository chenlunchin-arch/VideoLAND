import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateTierDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  monthlyMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPrice?: number;
}

export class UpdateExtraHourPriceDto {
  @IsInt()
  @Min(0)
  price: number;
}
