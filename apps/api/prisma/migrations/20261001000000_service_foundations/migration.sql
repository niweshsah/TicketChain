ALTER TABLE tc_listing ADD COLUMN waiting_room BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE tc_aggregateversion (id TEXT PRIMARY KEY, version BIGINT NOT NULL);
CREATE TABLE tc_outbox (
  id UUID PRIMARY KEY,
  dedupe TEXT NOT NULL UNIQUE,
  destination TEXT NOT NULL,
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ
);
CREATE INDEX tc_outbox_pending ON tc_outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE tc_inbox (consumer TEXT NOT NULL, message_id UUID NOT NULL, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(consumer,message_id));
CREATE TABLE tc_catalogevent (id UUID PRIMARY KEY, version BIGINT NOT NULL, document JSONB NOT NULL);
