import { eventSchema, publicationProblems } from '@ticketchain/shared';
import { randomUUID } from 'node:crypto';
import { one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { type Account } from '../../../shared/types';
import { lockEvent, lockTiers, notifyEvent, eventDetails } from './queries';

export async function saveEvent(
  organizer: Account,
  body: unknown,
  id?: string,
  stableId?: string,
) {
  assertRule(
    organizer.role === 'organizer',
    'FORBIDDEN',
    'Organizer account required',
    403,
  );
  const input = eventSchema.parse(body);
  const eventId = id || stableId || randomUUID();
  await transaction(async (tx) => {
    const existingEvent = id ? await lockEvent(tx, id) : undefined;
    if (existingEvent) {
      assertRule(
        existingEvent.owner_id === organizer.id,
        'FORBIDDEN',
        'You do not own this event',
        403,
      );
      assertRule(
        ['draft', 'published'].includes(existingEvent.status),
        'EVENT_CLOSED',
        'This event cannot be edited',
      );
      assertRule(
        !existingEvent.sale_started ||
          (existingEvent.starts_at.getTime() ===
            new Date(input.startsAt).getTime() &&
            existingEvent.ends_at.getTime() ===
              new Date(input.endsAt).getTime() &&
            existingEvent.timezone === input.timezone),
        'DATES_FROZEN',
        'Dates and timezone are frozen after a sale',
      );
    }
    assertRule(
      new Date(input.startsAt) > new Date(),
      'PAST_EVENT',
      'Start must be in the future',
    );
    if (!existingEvent)
      await tx.$executeRawUnsafe(
        `
          INSERT INTO tc_listing(id,owner_id,title,description,category,venue,city,timezone,image_url,starts_at,ends_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)
        `,
        eventId,
        organizer.id,
        input.title,
        input.description,
        input.category,
        input.venue,
        input.city,
        input.timezone,
        input.imageUrl,
        input.startsAt,
        input.endsAt,
      );
    else
      await tx.$executeRawUnsafe(
        'UPDATE tc_listing SET title=$2,description=$3,category=$4,venue=$5,city=$6,timezone=$7,image_url=$8,starts_at=$9::timestamptz,ends_at=$10::timestamptz WHERE id=$1::uuid',
        eventId,
        input.title,
        input.description,
        input.category,
        input.venue,
        input.city,
        input.timezone,
        input.imageUrl,
        input.startsAt,
        input.endsAt,
      );
    await tx.$executeRawUnsafe(
      'UPDATE tc_listing SET waiting_room=$2 WHERE id=$1::uuid',
      eventId,
      input.waitingRoom ?? false,
    );
    await tx.$executeRawUnsafe(
      `
        UPDATE tc_listing
        SET performers=$2::text[],venue_address=$3,entry_at=$4::timestamptz,languages=$5::text[],age_policy=$6,accessibility_notes=$7,test_marker=COALESCE(test_marker,$8)
        WHERE id=$1::uuid
      `,
      eventId,
      input.performers ?? null,
      input.venueAddress ?? null,
      input.entryAt ?? null,
      input.languages ?? null,
      input.agePolicy ?? null,
      input.accessibilityNotes ?? null,
      input.testMarker ?? null,
    );
    if (existingEvent?.status === 'published')
      assertRule(
        !publicationProblems(input).length,
        'PUBLICATION_INCOMPLETE',
        publicationProblems(input).join(' · '),
      );
    const existing = await lockTiers(tx, eventId);
    for (const removed of existing.filter(
      (tier) =>
        tier.status === 'active' &&
        !input.tiers.some((candidate) => candidate.id === tier.id),
    )) {
      const history = await one(
        tx,
        'SELECT 1 FROM tc_purchaseitem WHERE tier_id=$1::uuid UNION ALL SELECT 1 FROM tc_allocation a JOIN tc_inventoryunit i ON i.id=a.unit_id WHERE i.tier_id=$1::uuid LIMIT 1',
        removed.id,
      );
      if (history)
        await tx.$executeRawUnsafe(
          "UPDATE tc_tier SET status='retired' WHERE id=$1::uuid",
          removed.id,
        );
      else {
        await tx.$executeRawUnsafe(
          'DELETE FROM tc_inventoryunit WHERE tier_id=$1::uuid',
          removed.id,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM tc_tier WHERE id=$1::uuid',
          removed.id,
        );
      }
    }
    for (const tier of input.tiers) {
      const prior = existing.find(
        (existingTier) => existingTier.id === tier.id,
      );
      assertRule(
        !tier.id || prior?.status === 'active',
        'TIER_INVALID',
        'Tier does not belong to this event',
      );
      const tierId = prior?.id || randomUUID();
      if (prior) {
        assertRule(
          !prior.sale_started ||
            (prior.price_paise === tier.pricePaise &&
              (prior.price_octas?.toString() || undefined) === tier.priceOctas),
          'PRICE_FROZEN',
          'Sold tier prices are frozen',
        );
        const count = requireValue(
          await one<{ count: number }>(
            tx,
            'SELECT count(*)::int AS count FROM tc_inventoryunit i JOIN tc_allocation a ON a.unit_id=i.id WHERE i.tier_id=$1::uuid AND a.active',
            tierId,
          ),
        ).count;
        assertRule(
          tier.quantity >= count,
          'INVENTORY_IN_USE',
          'Cannot reduce inventory below held and committed units',
        );
        await tx.$executeRawUnsafe(
          'UPDATE tc_tier SET name=$2,price_paise=$3,price_octas=$4::bigint,quantity=$5 WHERE id=$1::uuid',
          tierId,
          tier.name,
          tier.pricePaise,
          tier.priceOctas || null,
          tier.quantity,
        );
        if (tier.quantity < prior.quantity) {
          await tx.$executeRawUnsafe(
            `
              UPDATE tc_inventoryunit
              SET enabled=false
              WHERE id IN (SELECT i.id
              FROM tc_inventoryunit i
              WHERE i.enabled
              AND tier_id=$1::uuid
              AND NOT EXISTS(SELECT 1
              FROM tc_allocation a
              WHERE a.unit_id=i.id
              AND a.active)
              ORDER BY id
              LIMIT $2)
            `,
            tierId,
            prior.quantity - tier.quantity,
          );
        }
      } else
        await tx.$executeRawUnsafe(
          'INSERT INTO tc_tier(id,event_id,name,price_paise,price_octas,quantity) VALUES($1::uuid,$2::uuid,$3,$4,$5::bigint,$6)',
          tierId,
          eventId,
          tier.name,
          tier.pricePaise,
          tier.priceOctas || null,
          tier.quantity,
        );
      await tx.$executeRawUnsafe(
        'UPDATE tc_tier SET inclusions=$2::text[] WHERE id=$1::uuid',
        tierId,
        tier.inclusions ?? null,
      );
      const increase = tier.quantity - (prior?.quantity || 0);
      if (increase > 0)
        await tx.$executeRawUnsafe(
          'INSERT INTO tc_inventoryunit(id,tier_id) SELECT gen_random_uuid(),$1::uuid FROM generate_series(1,$2::int)',
          tierId,
          increase,
        );
    }
    await notifyEvent(tx, eventId);
  });
  return eventDetails(eventId, organizer.id);
}
