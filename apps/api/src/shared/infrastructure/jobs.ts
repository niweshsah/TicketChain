import { randomUUID } from 'node:crypto';
import { db, one, type Tx } from '../db';
import { type Job } from '../types';

export async function enqueue(
  tx: Tx,
  kind: string,
  dedupe: string,
  payload: Record<string, unknown>,
  delay = 0,
) {
  await tx.$executeRawUnsafe(
    "INSERT INTO tc_job(id,kind,dedupe,payload,run_at) VALUES($1::uuid,$2,$3,$4::jsonb,now()+$5::int*interval '1 second') ON CONFLICT(dedupe) DO NOTHING",
    randomUUID(),
    kind,
    dedupe,
    JSON.stringify(payload),
    delay,
  );
}

export async function claimJob(owner: string): Promise<Job | undefined> {
  return one<Job>(
    db,
    `
      UPDATE tc_job
      SET status='running',lease_until=now()+interval '60 seconds',lease_owner=$1,attempts=attempts+1
      WHERE id=(SELECT id
      FROM tc_job
      WHERE (status='ready'
      AND run_at<=now())
      OR (status='running'
      AND lease_until<now())
      ORDER BY run_at,id FOR UPDATE SKIP LOCKED
      LIMIT 1)
      RETURNING *
    `,
    owner,
  );
}

export async function finishJob(job: Job) {
  await db.$executeRawUnsafe(
    "UPDATE tc_job SET status='done',lease_until=NULL WHERE id=$1::uuid AND lease_owner=$2",
    job.id,
    job.lease_owner,
  );
}

export async function failJob(job: Job, uncertain: boolean, reason: string) {
  await db.$executeRawUnsafe(
    "UPDATE tc_job SET status=$3,error=$4,lease_until=NULL,run_at=now()+$5::int*interval '1 second' WHERE id=$1::uuid AND lease_owner=$2",
    job.id,
    job.lease_owner,
    uncertain || job.attempts >= 6 ? 'manual_review' : 'ready',
    reason.slice(0, 200),
    Math.min(300, 2 ** job.attempts),
  );
}
