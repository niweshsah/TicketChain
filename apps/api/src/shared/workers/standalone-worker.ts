import { randomUUID } from 'node:crypto';
import { AmbiguousOperation } from '../../services/payments/razorpay/client';
import { db } from '../db';
import { claimJob, finishJob, failJob } from '../infrastructure/jobs';
import { processJob } from './job-dispatcher';

export async function workerOnce(owner = randomUUID()) {
  const job = await claimJob(owner);
  if (!job) return false;
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
    await failJob(
      job,
      error instanceof AmbiguousOperation,
      error instanceof Error ? error.message : 'Job failed',
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

export async function startStandaloneWorker() {
  let stopping = false;
  const owner = randomUUID();
  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(JSON.stringify({ event: 'worker_started', owner }));
  while (!stopping) {
    try {
      await db.$executeRawUnsafe(
        "INSERT INTO tc_ratebucket(key,count,expires_at) VALUES('worker-health',1,now()+interval '30 seconds') ON CONFLICT(key) DO UPDATE SET expires_at=EXCLUDED.expires_at",
      );
      if (!(await workerOnce(owner)))
        await new Promise((r) => setTimeout(r, 500));
    } catch {
      console.error(JSON.stringify({ event: 'worker_database_failure' }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await db.$disconnect();
}
