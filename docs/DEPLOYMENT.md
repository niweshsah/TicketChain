# Local container deployment

For a public demo with one instance per service on a single free VM, see
[single-server demo hosting](DEMO_HOSTING.md).

Requirements: Docker Desktop/Engine with Compose v2 and sufficient memory for Elasticsearch (the local container has a 1 GB limit). OAuth settings remain in the ignored root `.env`.

```bash
docker compose up -d --build
```

Open http://localhost:8080. Profile is at `/profile`; organizer tools are at `/organizer`. Local seed accounts use `attendee@demo.ticketchain.local` or `organizer@demo.ticketchain.local`, password `TicketChain!2026`. The same account can attend events and explicitly enable organizing. Payments default to demo INR; real money is not charged. Optional wallet features use Aptos testnet.

Startup runs controlled additive source migrations, non-destructive source seeding, and service database bootstrap. Existing service databases are never overwritten on repeated startup. PostgreSQL volumes and the original source database remain intact. Bootstrap saves an owner-only source snapshot in the `source-backups` volume and generates persistent RSA keys. Only Identity mounts the private key. Service databases use separate non-superuser logins.

The web gateway is the only public application port. PostgreSQL is exposed on loopback for local tools; RabbitMQ's local management console is http://localhost:15672 (`ticketchain` / `localbroker`). Redis and Elasticsearch remain internal. All supplied passwords are local demonstration defaults.

```bash
docker compose -f compose.yaml -f compose.scale.yaml up -d --build
docker compose --profile observability up -d prometheus grafana
docker compose --profile validation run --rm validation
```

The scale override creates two API replicas per service and two Booking/Payments workers. The local data/search/broker nodes remain single instances. Keep the scale override in subsequent deployment commands when retaining replicas.

Operations:

```bash
docker compose exec booking-worker npm run ops -w @ticketchain/api -- list
docker compose exec payments-worker npm run ops -w @ticketchain/api -- list
docker compose exec booking-worker npm run queue:ops -w @ticketchain/api -- list
docker compose exec payments-worker npm run queue:ops -w @ticketchain/api -- list
docker compose exec catalog-worker npm run search:rebuild -w @ticketchain/api
docker compose exec booking node apps/api/dist/scripts/demo-imagery.js
```

`queue:ops replay MESSAGE_ID RECONCILIATION_REFERENCE` replays one reviewed dead-letter message while preserving its identity. Never blindly retry a financial submission; reconcile provider identifiers first. `ops resolve-demo` provides explicit local resolution of uncertain demo outcomes. Delayed jobs retain database schedules, leases, backoff, and external identifiers.

API liveness/readiness: `/health/live` and `/health/ready` on each internal API. Prometheus scrapes each service's `/metrics`; logs omit query strings, tokens, payment evidence, and admission credentials. Worker health uses persisted expiring heartbeats. Graceful shutdown drains processing before closing dependencies.

Verify the working stack with `npm run test:services`, `npm run test:e2e` configured for localhost:8080, and `npm run test:failures`. The failure drill temporarily restarts dependencies and restores them in a finally block; use it only on the local demonstration stack.

For non-local deployment, replace every demo credential, configure HTTPS and service authentication, set production provider credentials, and size database pools against aggregate replica counts. Compose's single-node dependencies are not a highly available production deployment. Demo payments are rejected in production unless explicitly enabled with `ALLOW_DEMO_PAYMENTS=true`; the isolated demo deployment deliberately enables that setting. Live provider consent and testnet transactions require separate credential-dependent verification.
