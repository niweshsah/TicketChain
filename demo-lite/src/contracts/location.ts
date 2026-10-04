import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
export const cities = [
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
  'Lucknow',
  'Chandigarh',
  'Goa',
  'Indore',
  'Bhopal',
  'Surat',
  'Vadodara',
  'Nagpur',
  'Nashik',
  'Coimbatore',
  'Thiruvananthapuram',
  'Visakhapatnam',
  'Bhubaneswar',
  'Guwahati',
  'Patna',
  'Ranchi',
  'Mysuru',
  'Mangaluru',
  'Dehradun',
  'Amritsar',
] as const;
export const citySchema = z.enum(cities);
export const categories = [
  'Concert',
  'Festival',
  'Comedy',
  'Jazz',
  'Acoustic',
  'Electronic',
  'Theatre',
  'Workshop',
] as const;
export const languages = [
  'Hindi',
  'English',
  'Kannada',
  'Tamil',
  'Telugu',
  'Marathi',
  'Bengali',
  'Malayalam',
  'Gujarati',
  'Punjabi',
  'Odia',
  'Assamese',
  'Urdu',
  'Instrumental',
] as const;
export const agePolicies = [
  'All ages',
  '5+',
  '12+',
  '16+',
  '18+',
  '21+',
] as const;
export { rupeesToPaise } from '../lib/money';
export function localToUtc(local: string, timezone: string): string {
  try {
    return Temporal.PlainDateTime.from(local)
      .toZonedDateTime(timezone, { disambiguation: 'reject' })
      .toInstant()
      .toString();
  } catch {
    throw new Error(
      'Invalid or ambiguous local time. Choose another time in the selected timezone.',
    );
  }
}
export function utcToLocal(utc: string, timezone: string): string {
  return Temporal.Instant.from(utc)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString()
    .slice(0, 16);
}
export function publicationProblems(v: {
  description: string;
  category: string;
  venueAddress?: string | null;
  languages?: string[] | null;
  agePolicy?: string | null;
  performers?: string[] | null;
}): string[] {
  return [
    !v.description.trim() && 'Add a description',
    !v.venueAddress?.trim() && 'Add the venue address',
    !v.languages?.length && 'Select a language',
    !v.agePolicy && 'Select an age policy',
    ['Concert', 'Festival', 'Jazz', 'Acoustic', 'Electronic'].includes(
      v.category,
    ) &&
      !v.performers?.length &&
      'Add a performer',
  ].filter(Boolean) as string[];
}
