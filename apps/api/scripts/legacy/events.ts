import { str, num } from './contracts';
import { type LegacyAnalysis } from './analysis';
import { type Tx } from '../../src/shared/db';

export async function importEventsAndInventory(
  tx: Tx,
  { list, find, issues, mapping }: LegacyAnalysis,
) {
  const importedEvents = new Set<string>();
  for (const e of list('Event')) {
    const owner = find('Organizer', str(e, 'organizerId'));
    const venue = find('Venue', str(e, 'venueId'));
    if (
      !owner ||
      !venue ||
      !str(e, 'endsAt') ||
      new Date(str(e, 'endsAt')) <= new Date(str(e, 'startsAt'))
    )
      continue;
    await tx.$executeRawUnsafe(
      "INSERT INTO tc_listing(id,owner_id,title,description,category,venue,city,timezone,image_url,starts_at,ends_at,status,created_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,'draft',$12::timestamptz)",
      e.id,
      str(owner, 'userId'),
      str(e, 'title'),
      str(e, 'description'),
      str(e, 'category'),
      str(venue, 'name'),
      str(venue, 'city'),
      mapping.timezoneByEvent[e.id] || 'UTC',
      str(e, 'imageUrl'),
      str(e, 'startsAt'),
      str(e, 'endsAt'),
      str(e, 'createdAt'),
    );
    importedEvents.add(e.id);
  }
  const importedTiers = new Set<string>();
  for (const t of list('TicketType')) {
    if (
      !importedEvents.has(str(t, 'eventId')) ||
      issues.some((i) => i.table === 'TicketType' && i.id === t.id)
    )
      continue;
    await tx.$executeRawUnsafe(
      'INSERT INTO tc_tier(id,event_id,name,price_paise,quantity) VALUES($1::uuid,$2::uuid,$3,$4,$5)',
      t.id,
      str(t, 'eventId'),
      str(t, 'name'),
      num(t, 'priceCents'),
      Math.max(1, num(t, 'totalQuantity')),
    );
    importedTiers.add(t.id);
  }
  for (const t of list('Ticket'))
    if (importedTiers.has(str(t, 'ticketTypeId')))
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_inventoryunit(id,tier_id,enabled) VALUES($1::uuid,$2::uuid,$3)',
        t.id,
        str(t, 'ticketTypeId'),
        str(t, 'status') === 'available',
      );
  return { events: importedEvents, tiers: importedTiers };
}
