import { Router } from 'express';
import { Counter, Gauge, Registry } from 'prom-client';
import { config } from '../config';
import { db, rows, one } from '../db';
import { asyncRoute } from './context';

export const metricsRouter = Router();
export const registry = new Registry();

export const httpFailures = new Counter({
  name: 'ticketchain_http_failures_total',
  help: 'HTTP failures',
  labelNames: ['class'],
  registers: [registry],
});

export const conflicts = new Counter({
  name: 'ticketchain_inventory_conflicts_total',
  help: 'Inventory conflicts',
  registers: [registry],
});

export const outcomes = new Gauge({
  name: 'ticketchain_orders',
  help: 'Order outcomes',
  labelNames: ['status'],
  registers: [registry],
});

export const backlog = new Gauge({
  name: 'ticketchain_jobs',
  help: 'Durable jobs',
  labelNames: ['status'],
  registers: [registry],
});

export const oldest = new Gauge({
  name: 'ticketchain_oldest_pending_job_seconds',
  help: 'Oldest pending job',
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: 'ticketchain_outbox_pending',
  help: 'Unpublished durable messages',
  registers: [registry],
});

export const oldestOutbox = new Gauge({
  name: 'ticketchain_oldest_outbox_seconds',
  help: 'Age of oldest unpublished message',
  registers: [registry],
});

export const workerHealth = new Gauge({
  name: 'ticketchain_worker_healthy',
  help: 'Worker heartbeat',
  registers: [registry],
});

metricsRouter.get(
  '/metrics',
  asyncRoute(async (_req, res) => {
    const pending = await one<{ count: number; age: number }>(
      db,
      'SELECT count(*)::int AS count,coalesce(extract(epoch FROM now()-min(created_at)),0)::float AS age FROM tc_outbox WHERE published_at IS NULL',
    );
    outboxPending.set(pending?.count || 0);
    oldestOutbox.set(Number(pending?.age || 0));
    if (['identity', 'catalog'].includes(config.SERVICE_NAME)) {
      res.type(registry.contentType).send(await registry.metrics());
      return;
    }
    for (const row of await rows<{ status: string; count: number }>(
      db,
      'SELECT status,count(*)::int AS count FROM tc_purchase GROUP BY status',
    ))
      if (
        [
          'held',
          'expired',
          'paid',
          'refund_pending',
          'refunded',
          'manual_review',
          'cancelled',
        ].includes(row.status)
      )
        outcomes.set({ status: row.status }, row.count);
    for (const row of await rows<{ status: string; count: number }>(
      db,
      'SELECT status,count(*)::int AS count FROM tc_job GROUP BY status',
    ))
      if (
        ['ready', 'queued', 'running', 'done', 'manual_review'].includes(
          row.status,
        )
      )
        backlog.set({ status: row.status }, row.count);
    oldest.set(
      Number(
        (
          await one<{ age: number }>(
            db,
            "SELECT coalesce(extract(epoch FROM now()-min(created_at)),0)::float AS age FROM tc_job WHERE status IN ('ready','queued','running')",
          )
        )?.age || 0,
      ),
    );
    workerHealth.set(
      (await one(
        db,
        "SELECT key FROM tc_ratebucket WHERE key='worker-health' AND expires_at>now()",
      ))
        ? 1
        : 0,
    );
    res.type(registry.contentType).send(await registry.metrics());
  }),
);
