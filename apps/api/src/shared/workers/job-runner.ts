import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AmbiguousOperation } from '../../services/payments/razorpay/client';
import { config } from '../config';
import { db, one, transaction } from '../db';
import { finishJob, failJob } from '../infrastructure/jobs';
import { publishIntent, type DomainMessage } from '../infrastructure/messages';
import { type Job, type Operation } from '../types';
import { processJob } from './job-dispatcher';

export async function runQueuedJob(message: DomainMessage) {
  const input = z
    .object({ jobId: z.string().uuid(), attempt: z.number().int().positive() })
    .parse(message.payload);
  const owner = randomUUID();
  const job = await one<Job>(
    db,
    `
      UPDATE tc_job
      SET status='running',lease_owner=$2,lease_until=now()+interval '60 seconds',attempts=attempts+1
      WHERE id=$1::uuid
      AND status IN ('queued','ready')
      AND attempts=$3
      RETURNING *
    `,
    input.jobId,
    owner,
    input.attempt - 1,
  );
  if (!job) return;
  const heartbeat = setInterval(() => {
    void db
      .$executeRawUnsafe(
        "UPDATE tc_job SET lease_until=now()+interval '60 seconds' WHERE id=$1::uuid AND lease_owner=$2 AND status='running'",
        job.id,
        owner,
      )
      .catch(() => undefined);
  }, 15000);
  try {
    await processJob(job);
    await finishJob(job);
  } catch (error) {
    if (
      error instanceof AmbiguousOperation &&
      config.SERVICE_NAME === 'payments' &&
      job.payload.operationId
    ) {
      const operation = await one<Operation>(
        db,
        'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
        job.payload.operationId,
      );
      if (operation && operation.kind === 'payment')
        await transaction((tx) =>
          publishIntent(
            tx,
            'payment.review',
            operation.order_id,
            {
              orderId: operation.order_id,
              operationId: operation.id,
              provider: operation.provider,
              externalId: operation.external_id,
              reason: 'Provider operation requires reconciliation',
            },
            'booking',
            `review:${operation.id}`,
          ),
        );
    }
    await failJob(
      job,
      error instanceof AmbiguousOperation,
      error instanceof Error ? error.message : 'Job failed',
    );
  } finally {
    clearInterval(heartbeat);
  }
}
