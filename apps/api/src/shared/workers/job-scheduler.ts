import { config } from '../config';
import { rows, transaction } from '../db';
import { publishIntent } from '../infrastructure/messages';
import { type Job } from '../types';

export async function scheduleJobs() {
  await transaction(async (tx) => {
    const jobs = await rows<Job>(
      tx,
      "SELECT * FROM tc_job WHERE (status='ready' AND run_at<=now()) OR (status IN ('running','queued') AND lease_until<now()) ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 30",
    );
    for (const job of jobs) {
      await tx.$executeRawUnsafe(
        "UPDATE tc_job SET status='queued',lease_until=now()+interval '60 seconds' WHERE id=$1::uuid",
        job.id,
      );
      await publishIntent(
        tx,
        'job.ready',
        job.id,
        { jobId: job.id, attempt: job.attempts + 1 },
        config.SERVICE_NAME,
        `job:${job.id}:${job.attempts + 1}`,
      );
    }
  });
}
