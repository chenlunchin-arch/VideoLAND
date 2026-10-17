import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface DatabaseCheck {
  ok: boolean;
  latencyMs: number;
  /** Present only on failure. Never includes the connection string. */
  error?: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs a trivial query. Deliberately reports only an error *class*, not the
   * message: Prisma errors can embed host/database names, and health endpoints
   * are frequently public.
   */
  async checkDatabase(): Promise<DatabaseCheck> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const error = this.classify(err);
      this.logger.warn(`Health check failed: ${error}`);
      return { ok: false, latencyMs, error };
    }
  }

  private classify(err: unknown): string {
    const code = (err as { code?: string })?.code;
    if (code === 'P1000') return 'AUTH_FAILED';
    if (code === 'P1001') return 'UNREACHABLE';
    if (code === 'P1008') return 'TIMEOUT';
    return 'UNKNOWN';
  }
}
