import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let unsafe = key?.startsWith('sb_secret_');
try {
  unsafe ||= JSON.parse(atob(key?.split('.')[1] || '')).role === 'service_role';
} catch {
  /* Publishable keys are not JWTs. */
}
export const configured = Boolean(
  url?.startsWith('http') &&
  key &&
  !unsafe &&
  !url.includes('YOUR_PROJECT') &&
  !key.includes('REPLACE_ME'),
);
export const client = configured ? createClient(url, key) : null;

export async function result(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
