import { eventSchema, publicationProblems } from '@ticketchain/shared';
import { transaction } from '../../../shared/db';
import { assertRule } from '../../../shared/errors';
import { enqueue } from '../../../shared/infrastructure/jobs';
import { type Account } from '../../../shared/types';
import { lockEvent, lockTiers, eventDetails, notifyEvent } from './queries';

export async function transitionEvent(
  organizer: Account,
  id: string,
  action: 'publish' | 'cancel' | 'finish',
) {
  await transaction(async (tx) => {
    const event = await lockEvent(tx, id);
    assertRule(
      event.owner_id === organizer.id && organizer.role === 'organizer',
      'FORBIDDEN',
      'You do not own this event',
      403,
    );
    await lockTiers(tx, id);
    if (action === 'publish') {
      assertRule(
        event.status === 'draft' && event.starts_at > event.now,
        'INVALID_TRANSITION',
        'Only future drafts can be published',
      );
      const problems = publicationProblems({
        description: event.description,
        category: event.category,
        venueAddress: event.venue_address,
        languages: event.languages,
        agePolicy: event.age_policy,
        performers: event.performers,
      });
      assertRule(
        !problems.length,
        'PUBLICATION_INCOMPLETE',
        problems.join(' · '),
      );
      const details = await eventDetails(id, organizer.id);
      eventSchema.parse({
        title: event.title,
        description: event.description,
        category: event.category,
        venue: event.venue,
        city: event.city,
        timezone: event.timezone,
        imageUrl: event.image_url,
        startsAt: event.starts_at.toISOString(),
        endsAt: event.ends_at.toISOString(),
        tiers: details.tiers.map((tier) => ({
          name: tier.name,
          pricePaise: tier.price_paise,
          quantity: tier.quantity,
        })),
      });
    }
    if (action === 'finish')
      assertRule(
        event.status === 'published' && event.ends_at <= event.now,
        'INVALID_TRANSITION',
        'Finish after the event ends',
      );
    if (action === 'cancel') {
      assertRule(
        ['draft', 'published'].includes(event.status),
        'INVALID_TRANSITION',
        'Event is already closed',
      );
      await tx.$executeRawUnsafe(
        "UPDATE tc_admissionticket SET status='blocked' WHERE order_id IN (SELECT id FROM tc_purchase WHERE event_id=$1::uuid)",
        id,
      );
      await enqueue(tx, 'cancel', `cancel:${id}`, { eventId: id });
    }
    await tx.$executeRawUnsafe(
      'UPDATE tc_listing SET status=$2 WHERE id=$1::uuid',
      id,
      { publish: 'published', cancel: 'cancelled', finish: 'finished' }[action],
    );
    await notifyEvent(tx, id);
  });
  return eventDetails(id, organizer.id);
}
