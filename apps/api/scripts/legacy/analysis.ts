import { str, num, type LegacyDump, type LegacyMapping } from './contracts';

export function analyzeLegacy(dump: LegacyDump, mapping: LegacyMapping) {
  const list = (name: string) => dump.tables[name] || [];
  const find = (name: string, id: string) =>
    list(name).find((r) => r.id === id);
  const issues: { table: string; id: string; reason: string }[] = [];
  const issue = (table: string, id: string, reason: string) =>
    issues.push({ table, id, reason });
  for (const u of list('User'))
    if (
      !['attendee', 'organizer'].includes(str(u, 'role')) ||
      !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(str(u, 'passwordHash'))
    )
      issue(
        'User',
        u.id,
        'Unsupported role or password hash; inactive account',
      );
  for (const e of list('Event')) {
    const timezone = mapping.timezoneByEvent[e.id];
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone || 'INVALID' });
    } catch {
      issue(
        'Event',
        e.id,
        'Explicit valid IANA timezone required; event stays draft',
      );
    }
    if (
      !str(e, 'endsAt') ||
      new Date(str(e, 'endsAt')) <= new Date(str(e, 'startsAt'))
    )
      issue('Event', e.id, 'Valid start/end mapping required; archived only');
  }
  for (const t of list('TicketType'))
    if (
      !mapping.currencyByTier[t.id] ||
      !mapping.minorUnitByTier[t.id] ||
      mapping.currencyByTier[t.id] !== 'INR' ||
      mapping.minorUnitByTier[t.id] !== 'paise' ||
      num(t, 'priceCents') < 100
    )
      issue(
        'TicketType',
        t.id,
        'Explicit INR/paise mapping required for admission import; no currency conversion',
      );
  const orders = list('Order').map((o) => {
    const items = list('OrderItem').filter((i) => i.orderId === o.id);
    const tickets = items.map((i) => find('Ticket', str(i, 'ticketId')));
    const tiers = tickets.map(
      (t) => t && find('TicketType', str(t, 'ticketTypeId')),
    );
    const events = new Set(
      tiers.filter(Boolean).map((t) => str(t!, 'eventId')),
    );
    const evidence = mapping.paymentEvidenceByOrder[o.id];
    const reasons: string[] = [];
    if (!evidence)
      reasons.push(
        'No verified payment evidence; sold/minted flags are insufficient',
      );
    if (
      events.size !== 1 ||
      !items.length ||
      items.length > 10 ||
      tickets.some((t) => !t) ||
      tiers.some((t) => !t)
    )
      reasons.push('Unresolved, mixed-event, empty, or over-limit order');
    if (tiers.some((t) => !t || issues.some((i) => i.id === t.id)))
      reasons.push('Unresolved tier currency or minor units');
    const total = items.reduce(
      (sum, i) => sum + BigInt(num(i, 'priceCents')),
      0n,
    );
    if (
      total !== BigInt(num(o, 'totalCents')) ||
      (evidence &&
        (evidence.currency !== 'INR' || BigInt(evidence.amount) !== total))
    )
      reasons.push('Snapshot total and payment evidence differ');
    if (tickets.some((t) => t && str(t, 'status') === 'used'))
      reasons.push(
        'Historical check-in timestamp unavailable; admission blocked',
      );
    if (reasons.length) issue('Order', o.id, reasons.join('; '));
    return {
      o,
      items,
      tickets,
      tiers,
      eventId: [...events][0],
      total,
      evidence,
      resolved: reasons.length === 0,
    };
  });
  for (const r of list('Reservation'))
    issue(
      'Reservation',
      r.id,
      'Archived historical reservation; never revived as a current allocation',
    );
  return { dump, mapping, list, find, issues, orders };
}

export type LegacyAnalysis = ReturnType<typeof analyzeLegacy>;
