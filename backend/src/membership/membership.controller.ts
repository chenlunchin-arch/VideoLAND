import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { UpdateTierDto, UpdateExtraHourPriceDto } from './dto';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller()
export class MembershipController {
  constructor(private membership: MembershipService) {}

  // ---- 前台公開：顯示三個等級的方案內容 ----
  @Get('membership/tiers')
  listTiers() {
    return this.membership.listTiers();
  }

  // ---- 已登入會員：加購時數（正式環境應改由金流 webhook 觸發，這裡先開一支端點方便展示流程）----
  @UseGuards(AuthGuard)
  @Post('membership/extra-hours')
  purchaseExtraHours(@CurrentUser() user: { id: string }, @Body('hours') hours: number) {
    return this.membership.purchaseExtraHours(user.id, hours);
  }

  // ---- 後台管理：調整方案時數/價格、加購單價 ----
  @UseGuards(AuthGuard, AdminGuard)
  @Patch('admin/membership-tiers/:id')
  updateTier(@Param('id') id: string, @Body() dto: UpdateTierDto) {
    return this.membership.updateTier(id, dto);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Patch('admin/extra-hour-price')
  updateExtraHourPrice(@Body() dto: UpdateExtraHourPriceDto) {
    return this.membership.updateExtraHourPrice(dto.price);
  }
}
