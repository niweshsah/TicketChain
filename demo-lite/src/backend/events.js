import { eventSchema, publicationProblems } from '../contracts';
import { eventRows, eventDto, rpc, currentUser } from './data';

export async function discover(query) {
  const params = new URLSearchParams(query);
  let events = (await eventRows())
    .map(eventDto)
    .filter(
      (event) =>
        event.status === 'published' &&
        Date.parse(event.starts_at) > Date.now(),
    );
  if (params.get('city'))
    events = events.filter((event) => event.city === params.get('city'));
  if (params.get('category'))
    events = events.filter(
      (event) => event.category === params.get('category'),
    );
  const search = (params.get('q') || '').toLowerCase();
  if (search)
    events = events.filter((event) =>
      [event.title, ...(event.performers || [])]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  if (params.get('available') === 'true')
    events = events.filter((event) =>
      event.tiers.some((tier) => tier.available > 0),
    );
  events.sort((a, b) =>
    params.get('sort') === 'title'
      ? a.title.localeCompare(b.title)
      : params.get('sort') === 'newest'
        ? Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(a.starts_at) - Date.parse(b.starts_at),
  );
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 20));
  const offset = (Math.max(1, Number(params.get('page')) || 1) - 1) * limit;
  return { events: events.slice(offset, offset + limit) };
}

export async function event(id, preview = false) {
  const row = (await eventRows()).find((item) => item.id === id);
  if (!row) throw new Error('Event not found');
  const value = eventDto(row);
  if (preview && row.owner_id !== (await currentUser()).id)
    throw new Error('Event not found');
  if (!preview && value.status !== 'published')
    throw new Error('Event is no longer available');
  return value;
}

export async function organizerEvents() {
  const user = await currentUser();
  return (await eventRows())
    .filter((row) => row.owner_id === user.id)
    .map(eventDto);
}

export async function save(id, body) {
  const value = eventSchema.parse(body);
  const eventId = await rpc('tc_save_event', {
    p_event_id: id || null,
    p_event: value,
  });
  return event(eventId, true);
}

export async function transition(id, action) {
  if (action === 'publish') {
    const value = await event(id, true);
    const problems = publicationProblems({
      description: value.description,
      category: value.category,
      venueAddress: value.venue_address,
      languages: value.languages,
      agePolicy: value.age_policy,
      performers: value.performers,
    });
    if (problems.length) throw new Error(problems.join(' · '));
  }
  await rpc('tc_transition_event', { p_event_id: id, p_action: action });
  return event(id, true);
}
