import { Test } from '@nestjs/testing';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import * as Sentry from '@sentry/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { SentryExceptionFilter } from '../src/common/sentry-exception.filter';

it('500 is reported to Sentry, 4xx is not, responses unchanged', async () => {
  const spy = jest.spyOn(Sentry, 'captureException').mockImplementation(() => 'id' as any);
  const boom: any = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('db down'); } }) });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(boom).compile();
  const app = mod.createNestApplication();
  app.useGlobalFilters(new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.init();
  const r500 = await request(app.getHttpServer()).get('/categories');
  console.log('categories ->', r500.status, JSON.stringify(r500.body));
  expect(r500.status).toBe(500);
  expect(spy).toHaveBeenCalledTimes(1);
  const r401 = await request(app.getHttpServer()).get('/me');
  console.log('/me ->', r401.status);
  expect(r401.status).toBe(401);
  expect(spy).toHaveBeenCalledTimes(1);
  await app.close();
});
