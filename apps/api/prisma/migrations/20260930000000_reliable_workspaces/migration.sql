-- Additive: legacy tables and migration files are preserved.
CREATE TABLE tc_account (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "inactive_reason" TEXT,
  "wallet" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role IN ('attendee','organizer'))
);
CREATE TABLE tc_session (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "family" UUID NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ
);
CREATE TABLE tc_listing (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ NOT NULL,
  "ends_at" TIMESTAMPTZ NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sale_started" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (status IN ('draft','published','cancelled','finished'))
);
CREATE TABLE tc_tier (
  "id" UUID NOT NULL PRIMARY KEY,
  "event_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "price_paise" INTEGER NOT NULL,
  "price_octas" BIGINT,
  "quantity" INTEGER NOT NULL,
  "sale_started" BOOLEAN NOT NULL DEFAULT false,
  CHECK (price_paise >= 100 AND quantity > 0),
  CHECK (price_octas IS NULL OR price_octas > 0)
);
CREATE TABLE tc_inventoryunit (
  enabled BOOLEAN NOT NULL DEFAULT true,
  "id" UUID NOT NULL PRIMARY KEY,
  "tier_id" UUID NOT NULL
);
CREATE TABLE tc_purchase (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "idem_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "total" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'held',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, idem_key),
  CHECK (total > 0),
  CHECK (currency IN ('INR','APT'))
);
CREATE TABLE tc_allocation (
  "id" UUID NOT NULL PRIMARY KEY,
  "unit_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "state" TEXT NOT NULL DEFAULT 'held',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tc_purchaseitem (
  "id" UUID NOT NULL PRIMARY KEY,
  "order_id" UUID NOT NULL,
  "tier_id" UUID NOT NULL,
  "tier_name" TEXT NOT NULL,
  "price" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL
);
CREATE TABLE tc_admissionticket (
  "id" UUID NOT NULL PRIMARY KEY,
  "order_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL UNIQUE,
  "credential" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'valid',
  "checked_at" TIMESTAMPTZ
);
CREATE TABLE tc_provideroperation (
  "id" UUID NOT NULL PRIMARY KEY,
  "order_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'intent',
  "external_id" TEXT UNIQUE,
  "payment_id" TEXT UNIQUE,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, kind)
);
CREATE TABLE tc_webhookevent (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tc_job (
  "id" UUID NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "dedupe" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lease_until" TIMESTAMPTZ,
  "lease_owner" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tc_walletchallenge (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "wallet" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE tc_claim (
  "id" UUID NOT NULL PRIMARY KEY,
  "ticket_id" UUID NOT NULL UNIQUE,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "tx_hash" TEXT UNIQUE,
  "signed_bytes" TEXT,
  "sequence" BIGINT,
  "expiration" BIGINT
);
CREATE TABLE tc_ratebucket (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL
);
ALTER TABLE tc_session ADD FOREIGN KEY (user_id) REFERENCES tc_account(id) ON DELETE RESTRICT;
ALTER TABLE tc_listing ADD FOREIGN KEY (owner_id) REFERENCES tc_account(id) ON DELETE RESTRICT;
ALTER TABLE tc_tier ADD FOREIGN KEY (event_id) REFERENCES tc_listing(id) ON DELETE RESTRICT;
ALTER TABLE tc_inventoryunit ADD FOREIGN KEY (tier_id) REFERENCES tc_tier(id) ON DELETE RESTRICT;
ALTER TABLE tc_purchase ADD FOREIGN KEY (user_id) REFERENCES tc_account(id) ON DELETE RESTRICT;
ALTER TABLE tc_purchase ADD FOREIGN KEY (event_id) REFERENCES tc_listing(id) ON DELETE RESTRICT;
ALTER TABLE tc_allocation ADD FOREIGN KEY (unit_id) REFERENCES tc_inventoryunit(id) ON DELETE RESTRICT;
ALTER TABLE tc_allocation ADD FOREIGN KEY (order_id) REFERENCES tc_purchase(id) ON DELETE RESTRICT;
ALTER TABLE tc_purchaseitem ADD FOREIGN KEY (order_id) REFERENCES tc_purchase(id) ON DELETE RESTRICT;
ALTER TABLE tc_purchaseitem ADD FOREIGN KEY (tier_id) REFERENCES tc_tier(id) ON DELETE RESTRICT;
ALTER TABLE tc_admissionticket ADD FOREIGN KEY (order_id) REFERENCES tc_purchase(id) ON DELETE RESTRICT;
ALTER TABLE tc_admissionticket ADD FOREIGN KEY (allocation_id) REFERENCES tc_allocation(id) ON DELETE RESTRICT;
ALTER TABLE tc_provideroperation ADD FOREIGN KEY (order_id) REFERENCES tc_purchase(id) ON DELETE RESTRICT;
ALTER TABLE tc_walletchallenge ADD FOREIGN KEY (user_id) REFERENCES tc_account(id) ON DELETE RESTRICT;
ALTER TABLE tc_claim ADD FOREIGN KEY (ticket_id) REFERENCES tc_admissionticket(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX tc_current_allocation ON tc_allocation(unit_id) WHERE active;
CREATE INDEX tc_event_discovery ON tc_listing(status, starts_at, id);
CREATE INDEX tc_inventory_tier ON tc_inventoryunit(tier_id, id);
CREATE INDEX tc_allocation_order ON tc_allocation(order_id);
CREATE INDEX tc_purchase_expiry ON tc_purchase(status, expires_at);
CREATE INDEX tc_jobs_due ON tc_job(status, run_at, lease_until);
CREATE INDEX tc_sessions_family ON tc_session(family);
