import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

// 這是真正打 HTTP + 真正的 Postgres 的整合測試，跟 src/**/*.spec.ts 的 mock 單元測試不同層級。
// 跑之前要先啟動測試用資料庫並套用 migration：
//   docker compose -f docker-compose.test.yml up -d
//   DATABASE_URL=postgresql://test:test@localhost:5433/video_platform_test npx prisma db push --accept-data-loss
//   DATABASE_URL=postgresql://test:test@localhost:5433/video_platform_test npm run test:e2e
describe('影音平台 API（整合測試）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let videoId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = new PrismaClient();
    const category = await prisma.category.create({ data: { name: `測試分類-${Date.now()}` } });
    categoryId = category.id;
    const video = await prisma.video.create({
      data: { title: '測試影片', categoryId, durationMinutes: 30, status: 'published' },
    });
    videoId = video.id;
  });

  afterAll(async () => {
    await prisma.playbackSession.deleteMany({ where: { videoId } });
    await prisma.video.deleteMany({ where: { id: videoId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /categories 應該包含剛建立的測試分類', async () => {
    const res = await request(app.getHttpServer()).get('/categories').expect(200);
    expect(res.body.some((c: any) => c.id === categoryId)).toBe(true);
  });

  describe('會員註冊、登入、播放時數扣除', () => {
    const email = `test-${Date.now()}@example.com`;
    const password = 'Password123!';
    let accessToken: string;
    let userId: string;

    it('註冊後應該可以登入並取得 accessToken', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, name: '測試使用者' })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);

      accessToken = loginRes.body.accessToken;
      userId = loginRes.body.user.id;
      expect(accessToken).toBeTruthy();
    });

    it('沒有時數額度時開始播放應該回 403 quota_exceeded', async () => {
      const res = await request(app.getHttpServer())
        .post('/playback/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ videoId })
        .expect(403);
      expect(res.body.code).toBe('quota_exceeded');
    });

    it('有時數額度後應該可以開始播放，且心跳依經過時間正確扣除', async () => {
      await prisma.minuteLedger.create({
        data: { userId, period: '2099-01', source: 'monthly_grant', minutes: 120 },
      });

      const startRes = await request(app.getHttpServer())
        .post('/playback/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ videoId })
        .expect(201);
      const sessionId = startRes.body.sessionId;

      // 直接把 lastHeartbeatAt 往前調整 5 分鐘，模擬「已經看了 5 分鐘」才送出這次心跳，
      // 避免測試要真的等 5 分鐘
      await prisma.playbackSession.update({
        where: { id: sessionId },
        data: { lastHeartbeatAt: new Date(Date.now() - 5 * 60_000) },
      });

      const heartbeatRes = await request(app.getHttpServer())
        .post(`/playback/sessions/${sessionId}/heartbeat`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(heartbeatRes.body.remainingMinutes).toBe(115);

      await request(app.getHttpServer())
        .post(`/playback/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
    });
  });

  describe('訪客播放上限', () => {
    it('訪客累積滿 10 分鐘後，下一次心跳應該被擋下', async () => {
      const agent = request.agent(app.getHttpServer()); // 保留 cookie，模擬同一個訪客裝置

      const startRes = await agent.post('/playback/sessions').send({ videoId }).expect(201);
      const sessionId = startRes.body.sessionId;

      // 直接把這個 session 標記成已經看滿 10 分鐘，模擬訪客已經用完試看額度
      await prisma.playbackSession.update({ where: { id: sessionId }, data: { minutesConsumed: 10 } });

      const heartbeatRes = await agent.post(`/playback/sessions/${sessionId}/heartbeat`).expect(403);
      expect(heartbeatRes.body.code).toBe('guest_limit_reached');
    });
  });
});
