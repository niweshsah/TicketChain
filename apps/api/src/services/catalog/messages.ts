import { type DomainMessage } from '../../shared/infrastructure/messages';
import { updateProjection } from './projection';

export async function refreshEvent(message: DomainMessage) {
  await updateProjection(message);
}

export const messageHandlers = { 'event.refresh': refreshEvent };
