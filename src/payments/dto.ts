import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateOrderDto {
  @IsIn(['subscription', 'extra_hours'])
  type: 'subscription' | 'extra_hours';

  @IsIn(['ecpay', 'stripe'])
  gateway: 'ecpay' | 'stripe';

  // type = subscription 時需要
  @IsOptional()
  @IsUUID()
  tierId?: string;

  // type = extra_hours 時需要
  @IsOptional()
  @IsInt()
  @Min(1)
  hours?: number;
}
