import { randomUUID } from 'node:crypto';
import { config } from '../../shared/config';
import { serviceRequest } from '../../shared/service-client';
import { ensureIndex, updateProjection } from './projection';

export async function rebuildSearch() {
  await ensureIndex();
  const events = await serviceRequest<{ id: string; version: number }[]>(
    config.BOOKING_URL,
    '/internal/events',
  );
  for (const event of events) {
    await updateProjection(
      {
        id: randomUUID(),
        type: 'event.refresh',
        schemaVersion: 1,
        aggregateId: event.id,
        aggregateVersion: event.version,
        occurredAt: new Date().toISOString(),
        correlationId: event.id,
        payload: {},
      },
      true,
    );
  }
}
