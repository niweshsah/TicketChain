import { it, expect } from 'vitest';
import {
  cities,
  citySchema,
  localToUtc,
  utcToLocal,
  rupeesToPaise,
  publicationProblems,
  eventSchema,
} from '../../packages/shared/src';
it('allows thirty curated cities and rejects arbitrary locations', () => {
  expect(new Set(cities).size).toBe(30);
  expect(citySchema.safeParse('arbitrary').success).toBe(false);
});
it('converts decimal rupees exactly with bounded precision', () => {
  expect(rupeesToPaise('1499.99')).toBe(149999);
  expect(rupeesToPaise('1.01')).toBe(101);
  for (const v of ['1.001', '1e3', '-1', '0.99', '1000001'])
    expect(() => rupeesToPaise(v)).toThrow();
});
it('converts event timezone independently of the browser and rejects DST gaps and overlaps', () => {
  expect(localToUtc('2027-01-01T20:00', 'Asia/Kolkata')).toBe(
    '2027-01-01T14:30:00Z',
  );
  expect(utcToLocal('2027-01-01T14:30:00Z', 'Asia/Kolkata')).toBe(
    '2027-01-01T20:00',
  );
  expect(() => localToUtc('2027-03-14T02:30', 'America/New_York')).toThrow();
  expect(() => localToUtc('2027-11-07T01:30', 'America/New_York')).toThrow();
});
it('requires audience facts, description and performers for publication', () => {
  expect(
    publicationProblems({ description: '', category: 'Concert' }),
  ).toHaveLength(5);
  expect(
    publicationProblems({
      description: 'Show',
      category: 'Comedy',
      venueAddress: 'Road',
      languages: ['English'],
      agePolicy: '18+',
    }),
  ).toEqual([]);
});
it('rejects entry times more than a day before start', () => {
  const v = {
    title: 'Show',
    description: '',
    category: 'Concert',
    venue: 'Arena',
    city: 'Mumbai',
    timezone: 'Asia/Kolkata',
    imageUrl: 'https://example.com/poster.jpg',
    startsAt: '2027-01-02T14:30:00Z',
    endsAt: '2027-01-02T18:30:00Z',
    entryAt: '2027-01-01T14:29:00Z',
    tiers: [{ name: 'General', pricePaise: 100, quantity: 10 }],
  };
  expect(eventSchema.safeParse(v).success).toBe(false);
});
