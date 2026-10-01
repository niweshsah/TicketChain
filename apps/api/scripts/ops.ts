import { db, rows, transaction, one } from '../src/shared/db';
import { requireValue, assertRule } from '../src/shared/errors';
import { demoPaymentsAllowed } from '../src/shared/config';
import { type Operation } from '../src/shared/types';
import { z } from 'zod';
async function main() {
  const [command = 'list', id, evidence, outcome] = process.argv.slice(2);
  if (command === 'list') {
    console.table(
      await rows(
        db,
        "SELECT id,kind,status,attempts,run_at,error FROM tc_job WHERE status<>'done' ORDER BY created_at LIMIT 100",
      ),
    );
    return;
  }
  assertRule(
    ['retry', 'resolve-demo'].includes(command),
    'COMMAND_REQUIRED',
    'Use list | retry JOB_ID RECONCILIATION_REFERENCE | resolve-demo JOB_ID RECONCILIATION_REFERENCE success|failure',
  );
  z.string().uuid().parse(id);
  assertRule(
    evidence && evidence.length >= 10,
    'EVIDENCE_REQUIRED',
    'Provide a provider reconciliation reference. Submitted transaction identifiers are never cleared.',
  );
  await transaction(async (tx) => {
    const job = requireValue(
      await one<{
        status: string;
        kind: string;
        payload: Record<string, string>;
      }>(
        tx,
        'SELECT status,kind,payload FROM tc_job WHERE id=$1::uuid FOR UPDATE',
        id,
      ),
    );
    assertRule(
      job.status === 'manual_review',
      'NOT_FAILED',
      'Only manual-review jobs can be retried',
    );
    if (command === 'resolve-demo') {
      assertRule(
        demoPaymentsAllowed && job.kind === 'reconcile',
        'DEMO_ONLY',
        'Resolve-demo requires enabled demo payments and a reconciliation job',
      );
      const op = requireValue(
        await one<Operation>(
          tx,
          'SELECT * FROM tc_provideroperation WHERE id=$1::uuid FOR UPDATE',
          job.payload.operationId,
        ),
      );
      assertRule(
        op.provider === 'demo' && op.status === 'uncertain',
        'DEMO_ONLY',
        'Operation must be an uncertain demo payment',
      );
      z.enum(['success', 'failure']).parse(outcome);
      await tx.$executeRawUnsafe(
        'UPDATE tc_provideroperation SET data=data || $2::jsonb,status=$3 WHERE id=$1::uuid',
        op.id,
        JSON.stringify({ scenario: outcome, reviewReference: evidence }),
        outcome === 'success' ? 'ready' : 'failed',
      );
      if (outcome === 'failure') {
        await tx.$executeRawUnsafe(
          "UPDATE tc_job SET status='done',error=$2 WHERE id=$1::uuid",
          id,
          `Reviewed: ${evidence}`,
        );
        return;
      }
    }
    assertRule(
      job.kind !== 'initialize',
      'INITIALIZATION_REVIEW',
      'Reconcile ambiguous provider order creation by receipt, attach its identifier, and mark ready before retrying; automatic creation is unsafe',
    );
    await tx.$executeRawUnsafe(
      "UPDATE tc_job SET status='ready',run_at=now(),error=$2 WHERE id=$1::uuid",
      id,
      `Reviewed: ${evidence}`,
    );
  });
}
void main().finally(() => db.$disconnect());
