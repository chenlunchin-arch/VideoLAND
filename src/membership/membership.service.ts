import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateTierDto } from './dto';

@Injectable()
export class MembershipService {
  constructor(private prisma: PrismaService) {}

  listTiers() {
    return this.prisma.membershipTier.findMany({ orderBy: { level: 'asc' } });
  }

  updateTier(id: string, dto: UpdateTierDto) {
    return this.prisma.membershipTier.update({ where: { id }, data: dto });
  }

  async getExtraHourPrice() {
    const row = await this.prisma.extraHourPricing.findFirst({ orderBy: { updatedAt: 'desc' } });
    return { price: row?.price ?? 0 };
  }

  async updateExtraHourPrice(price: number) {
    const row = await this.prisma.extraHourPricing.create({ data: { price } });
    // 用新增一筆紀錄取最新值的方式保留歷史價格，避免直接覆蓋掉舊紀錄
    return row;
  }

  // 加購時數：直接寫入時數帳本（實務上應在收到金流 webhook 確認付款後才呼叫這裡）
  async purchaseExtraHours(userId: string, hours: number) {
    const period = currentPeriod();
    return this.prisma.minuteLedger.create({
      data: { userId, period, source: 'purchase', minutes: hours * 60 },
    });
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
