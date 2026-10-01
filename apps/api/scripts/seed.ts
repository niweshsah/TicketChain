import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../src/shared/config';
import { db, one } from '../src/shared/db';
import { saveEvent } from '../src/services/booking/events/editor';
import { transitionEvent } from '../src/services/booking/events/lifecycle';
import { type Account } from '../src/shared/types';
export async function seed() {
  if (new URL(config.DATABASE_URL).pathname !== `/${config.DEMO_DATABASE_NAME}`)
    throw new Error('Seed is restricted to the designated demo database');
  for (const role of ['attendee', 'organizer'] as const)
    await db.$executeRawUnsafe(
      'INSERT INTO tc_account(id,name,email,password_hash,role) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING',
      randomUUID(),
      `Demo ${role}`,
      `${role}@demo.ticketchain.local`,
      await bcrypt.hash(config.DEMO_ACCOUNT_PASSWORD || 'TicketChain!2026', 12),
      role,
    );
  const organizer = (await one<Account>(
    db,
    "SELECT * FROM tc_account WHERE email='organizer@demo.ticketchain.local'",
  ))!;
  const images = Array.from(
    { length: 8 },
    (_, index) =>
      `https://ticketchain.local/images/concerts/concert-${index + 1}.jpg`,
  );
  const titles = [
    'Midnight Echoes · Live',
    'Electric Skies Festival',
    'The Unplugged Sessions',
  ];
  for (let i = 0; i < titles.length; i++) {
    const eventId = `00000000-0000-4000-8000-00000000010${i}`;
    if (await one(db, 'SELECT id FROM tc_listing WHERE id=$1::uuid', eventId))
      continue;
    const starts = new Date(Date.now() + (30 + i * 7) * 86400000);
    const e = await saveEvent(
      organizer,
      {
        title: titles[i],
        description:
          'A night of live music, new connections, and moments that stay with you. Doors open early; your ticket is ready as soon as payment is confirmed.',
        performers: ['Fictional Demo Ensemble'],
        venueAddress: 'Fictional Central Road, demonstration venue',
        languages: ['English', 'Hindi'],
        agePolicy: 'All ages',
        category: i === 1 ? 'Festival' : 'Concert',
        venue: 'The Open Air Arena',
        city: ['Bengaluru', 'Mumbai', 'Delhi'][i],
        timezone: 'Asia/Kolkata',
        imageUrl: images[i],
        startsAt: starts.toISOString(),
        endsAt: new Date(+starts + 4 * 3600000).toISOString(),
        tiers: [
          { name: 'General admission', pricePaise: 149900, quantity: 60 },
          { name: 'Front row', pricePaise: 299900, quantity: 20 },
        ],
      },
      undefined,
      eventId,
    ); // Stable marker avoids touching edited events on repeat runs.
    await transitionEvent(organizer, e.id, 'publish');
  }

  const cities = [
    'Bengaluru',
    'Mumbai',
    'Delhi',
    'Hyderabad',
    'Chennai',
    'Pune',
    'Kolkata',
    'Ahmedabad',
    'Jaipur',
    'Kochi',
  ];
  const experiences = [
    { title: 'Indie After Hours', category: 'Concert', price: 89900 },
    { title: 'Neon Nights Festival', category: 'Festival', price: 179900 },
    { title: 'Jazz Under the Stars', category: 'Jazz', price: 119900 },
    { title: 'Sunset Acoustic Club', category: 'Acoustic', price: 69900 },
    { title: 'City Lights Live', category: 'Concert', price: 149900 },
    { title: 'Weekend Soundwaves', category: 'Electronic', price: 129900 },
  ];
  let createdEvents = 0;
  for (let index = 0; index < 30; index++) {
    // Deterministic identifiers make repeated or concurrent seeds non-destructive.
    const digest = createHash('sha256')
      .update(`expanded-demo-event:${index}`)
      .digest('hex');
    const eventId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    if (await one(db, 'SELECT id FROM tc_listing WHERE id=$1::uuid', eventId))
      continue;
    const experience = experiences[index % experiences.length];
    const city = cities[index % cities.length];
    const starts = new Date(Date.now() + (14 + index * 3) * 86400000);
    const event = await saveEvent(
      organizer,
      {
        waitingRoom: index === 29,
        title: `${experience.title} · ${city} ${Math.floor(index / cities.length) + 1}`,
        description: `A demo ${experience.category.toLowerCase()} experience in ${city}, with room for friends, great live sound and three ticket options. General admission includes entry; front row and VIP offer upgraded viewing areas. This is a fictional local demonstration event.`,
        performers: ['Fictional Demo Ensemble'],
        venueAddress: 'Fictional Central Road, demonstration venue',
        languages: ['English', 'Hindi'],
        agePolicy: 'All ages',
        category: experience.category,
        venue: `${city} Open Air Music Arena, Central Road`,
        city,
        timezone: 'Asia/Kolkata',
        imageUrl: images[index % images.length],
        startsAt: starts.toISOString(),
        endsAt: new Date(+starts + 4 * 3600000).toISOString(),
        tiers: [
          {
            name: 'General admission',
            pricePaise: experience.price,
            quantity: 1000,
          },
          {
            name: 'Front row',
            pricePaise: experience.price + 150000,
            quantity: 200,
          },
          {
            name: 'VIP experience',
            pricePaise: experience.price + 350000,
            quantity: 100,
          },
        ],
      },
      undefined,
      eventId,
    );
    await transitionEvent(organizer, event.id, 'publish');
    createdEvents++;
  }
  console.log(
    JSON.stringify({
      event: 'demo_seed_complete',
      newEvents: createdEvents,
      newInventoryUnits: createdEvents * 1300,
    }),
  );
}
if (require.main === module) void seed().finally(() => db.$disconnect());
