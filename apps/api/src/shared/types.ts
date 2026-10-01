export interface Account {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  role: 'attendee' | 'organizer';
  active: boolean;
  wallet: string | null;
  home_city: string | null;
  avatar_key: string | null;
}

export interface Listing {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  category: string;
  city: string;
  venue: string;
  timezone: string;
  image_url: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  performers: string[] | null;
  venue_address: string | null;
  entry_at: Date | null;
  languages: string[] | null;
  age_policy: string | null;
  accessibility_notes: string | null;
  waiting_room: boolean;
  sale_started: boolean;
}

export interface Tier {
  status: 'active' | 'retired';
  inclusions: string[] | null;
  id: string;
  event_id: string;
  name: string;
  price_paise: number;
  price_octas: bigint | null;
  quantity: number;
  sale_started: boolean;
}

export interface Purchase {
  id: string;
  user_id: string;
  event_id: string;
  idem_key: string;
  fingerprint: string;
  status: string;
  currency: 'INR' | 'APT';
  total: bigint;
  expires_at: Date;
  created_at: Date;
}

export interface Operation {
  id: string;
  order_id: string;
  kind: string;
  provider: string;
  status: string;
  external_id: string | null;
  payment_id: string | null;
  data: Record<string, unknown>;
}

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, string>;
  attempts: number;
  lease_owner: string;
}
