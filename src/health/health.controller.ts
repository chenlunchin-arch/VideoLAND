import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Liveness / readiness endpoint.
 *
 * Why this exists: Zeabur (and any uptime monitor) treats "container process
 * alive" as healthy. That is not the same thing. The entrypoint waits for the
 * database before starting the HTTP server, so a running container can sit
 * there for hours with no port bound and still show a green dot.
 *
 * Two levels are exposed:
 *   GET /health        - liveness, never touches the database. Fast, always
 *                        answers as long as the process is up.
 *   GET /health/ready  - readiness, runs `SELECT 1`. Returns 503 when the
 *                        database is unreachable, so a monitor can tell the
 *                        difference between "process up" and "actually usable".
 *
 * Throttling is skipped: monitors may poll frequently and must not be blocked.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  live() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const db = await this.health.checkDatabase();
    if (!db.ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'unavailable',
        checks: { database: db },
        timestamp: new Date().toISOString(),
      };
    }
    return {
      status: 'ok',
      checks: { database: db },
      timestamp: new Date().toISOString(),
    };
  }
}
