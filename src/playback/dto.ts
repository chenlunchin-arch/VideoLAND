import { IsUUID } from 'class-validator';

export class StartSessionDto {
  @IsUUID()
  videoId: string;
}
