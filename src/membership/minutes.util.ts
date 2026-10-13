import { PrismaService } from '../prisma.service';

// 共用邏輯：剩餘時數＝帳本加總（天然支援跨月累積），
// 目前方案＝最新一筆 active 訂閱對應的 tier.level。
// playback.service.ts 之後可以改成呼叫這裡，避免邏輯重複。
export async function getRemainingMinutes(prisma: PrismaService, userId: string): Promise<number> {
  const result = await prisma.minuteLedger.aggregate({
    where: { userId },
    _sum: { minutes: true },
  });
  return result._sum.minutes ?? 0;
}

export async function getActiveTierLevel(prisma: PrismaService, userId: string): Promise<number | null> {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: 'active' },
    include: { tier: true },
    orderBy: { currentPeriodStart: 'desc' },
  });
  return sub?.tier.level ?? null;
}
