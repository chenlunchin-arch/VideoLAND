import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  title: string;

  @IsUUID()
  categoryId: string;

  @IsInt()
  @Min(1)
  durationMinutes: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  status?: 'draft' | 'published' | 'hidden';
}

export class CreateCategoryDto {
  @IsString()
  name: string;
}
