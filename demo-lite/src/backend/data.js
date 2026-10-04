import { client, result } from '../lib/client';

export async function currentUser() {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw Object.assign(new Error('Please sign in to continue'), {
      status: 401,
    });
  return data.user;
}

export async function rpc(name, parameters) {
  try {
    return await result(client.rpc(name, parameters));
  } catch (error) {
    if (['PGRST202', 'PGRST204', '42P01'].includes(error.code)) {
      throw new Error(
        'This feature is temporarily unavailable. Please try again later.',
      );
    }
    throw error;
  }
}

export async function eventRows() {
  let response = await client
    .from('lite_events')
    .select('*, tiers:lite_tiers(*)');
  if (['PGRST200', 'PGRST205', '42P01'].includes(response.error?.code)) {
    response = await client.from('lite_events').select('*');
  }
  if (response.error) throw response.error;
  return response.data;
}

export function eventDto(row) {
  const metadata = row.metadata || {};
  const tiers = row.tiers || [
    {
      id: row.id,
      name: 'General admission',
      price_paise: row.price_paise,
      quantity: row.capacity,
      available: row.available,
      status: 'active',
    },
  ];
  const mapped = tiers.map((tier) => ({
    ...tier,
    price_octas: null,
    inclusions: tier.inclusions || [],
  }));
  const seedCategories = [
    'Concert',
    'Festival',
    'Jazz',
    'Electronic',
    'Acoustic',
    'Festival',
  ];
  const seed = /^00000000-0000-4000-8000-00000000000([1-6])$/.exec(row.id);
  return {
    ...row,
    ...metadata,
    description: seed
      ? row.description.replace(/\bdemo\b/gi, '').trim()
      : row.description,
    category:
      metadata.category ||
      (seed ? seedCategories[Number(seed[1]) - 1] : 'Concert'),
    timezone: metadata.timezone || 'Asia/Kolkata',
    image_url:
      metadata.imageUrl || `/images/concerts/concert-${row.image || 1}.jpg`,
    ends_at: metadata.endsAt || row.starts_at,
    entry_at: metadata.entryAt || null,
    venue_address: metadata.venueAddress || null,
    age_policy: metadata.agePolicy || null,
    accessibility_notes: metadata.accessibilityNotes || null,
    languages: metadata.languages || [],
    performers: metadata.performers || [],
    waiting_room: false,
    status: row.lifecycle || (row.published ? 'published' : 'draft'),
    tiers: mapped.filter((tier) => tier.status !== 'retired'),
    retired_tiers: mapped.filter((tier) => tier.status === 'retired'),
  };
}

export function orderDto(row) {
  return {
    ...row,
    event_title: row.event_title || row.event?.title || 'Event',
    currency: 'INR',
    total: String(row.total_paise),
    expires_at: row.created_at,
    items: row.items || [
      {
        tier_name: 'General admission',
        price: String(row.total_paise / row.quantity),
        quantity: row.quantity,
        tier_id: row.event_id,
      },
    ],
  };
}

export async function orderRows() {
  const user = await currentUser();
  return result(
    client
      .from('lite_orders')
      .select('*, event:lite_events(title,starts_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  );
}
