import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('rate limit behind proxy', () => {
  let app: any;
  beforeAll(async () => {
    const prismaMock: any = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => null }) });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prismaMock).compile();
    app = mod.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
  });
  afterAll(() => app.close());

  it('login: 6th request from same client IP gets 429, other IP unaffected', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await request(app.getHttpServer()).post('/auth/login')
        .set('X-Forwarded-For', '1.1.1.1').send({ email: 'a@b.com', password: 'xxxxxxxx' });
      codes.push(r.status);
    }
    console.log('same IP codes', codes);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes[5]).toBe(429);
    const other = await request(app.getHttpServer()).post('/auth/login')
      .set('X-Forwarded-For', '2.2.2.2').send({ email: 'a@b.com', password: 'xxxxxxxx' });
    console.log('other IP code', other.status);
    expect(other.status).not.toBe(429);
  });

  it('webhook is not throttled', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 110; i++) {
      const r = await request(app.getHttpServer()).post('/webhooks/mediaconvert').set('X-Forwarded-For', '3.3.3.3').send({});
      codes.push(r.status);
    }
    expect(codes.includes(429)).toBe(false);
  });
});
