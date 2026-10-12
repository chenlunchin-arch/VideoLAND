import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.membershipTier.createMany({
    data: [
      { level: 1, monthlyMinutes: 60 * 60, monthlyPrice: 299 },
      { level: 2, monthlyMinutes: 120 * 60, monthlyPrice: 499 },
      { level: 3, monthlyMinutes: 240 * 60, monthlyPrice: 899 },
    ],
    skipDuplicates: true,
  });

  await prisma.extraHourPricing.create({ data: { price: 39 } });

  const adminPasswordHash = await bcrypt.hash('ChangeMe123!', 10);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPasswordHash,
      name: '管理員',
      role: 'admin',
    },
  });

  const cat = await prisma.category.upsert({
    where: { name: '戲劇' },
    update: {},
    create: { name: '戲劇', sortOrder: 0 },
  });

  await prisma.video.create({
    data: {
      title: '深夜食堂',
      categoryId: cat.id,
      durationMinutes: 32,
      status: 'published',
    },
  });

  console.log('種子資料建立完成。管理員帳號：admin@example.com / ChangeMe123!（請上線前務必更改）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
