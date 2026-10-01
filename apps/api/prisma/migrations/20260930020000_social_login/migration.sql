ALTER TABLE tc_account ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE tc_oauthidentity (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tc_account(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE tc_oauthattempt (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  verifier text NOT NULL,
  role text NOT NULL CHECK (role IN ('attendee', 'organizer')),
  link_user_id uuid REFERENCES tc_account(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX tc_oauthattempt_expiry ON tc_oauthattempt(expires_at);
