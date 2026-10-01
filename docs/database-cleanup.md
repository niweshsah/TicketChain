# Database cleanup

`apps/api/scripts/cleanup-database.ts` targets the local `ticketchain_demo` or isolated `ticketchain_test` database set. It defaults to a dry run. It preserves database schemas and migration history.

Build the API image before running the command:

```bash
docker compose build bootstrap
```

Stop the web gateway and every API and worker before applying a cleanup. The command uses the bootstrap container's configured service database credentials and local search, cache, broker, and avatar storage endpoints.

```bash
docker compose -f compose.yaml -f compose.scale.yaml stop web identity booking booking-worker payments payments-worker catalog catalog-worker
```

Preview one account. The command accepts its UUID or current email. Account cleanup disables login, revokes sessions, disconnects sign-in providers, removes profile identifiers and avatar data, and preserves the account ID for paid/refunded history. An optional event UUID removes that event only if it is cancelled and has no purchases, allocations, or issued tickets.

```bash
docker compose -f compose.yaml -f compose.scale.yaml run --rm --no-deps bootstrap npm run db:cleanup -w @ticketchain/api -- --user ACCOUNT_UUID --event EVENT_UUID
```

Apply the previewed cleanup by confirming both exact UUIDs:

```bash
docker compose -f compose.yaml -f compose.scale.yaml run --rm --no-deps bootstrap npm run db:cleanup -w @ticketchain/api -- --user ACCOUNT_UUID --event EVENT_UUID --apply --writers-stopped --confirm-user ACCOUNT_UUID --confirm-event EVENT_UUID
```

To remove only a user, omit `--event`. To remove only an eligible event, use `--event EVENT_UUID` and `--confirm-event EVENT_UUID`.

Whole-database cleanup clears application tables in the preserved source and all four service databases. It also removes avatar objects, the Catalog search index, TicketChain Redis state, and messages in TicketChain RabbitMQ queues. Migration tables, database schemas, volumes, and unrelated infrastructure data remain.

```bash
docker compose -f compose.yaml -f compose.scale.yaml run --rm --no-deps bootstrap npm run db:cleanup -w @ticketchain/api -- --all
docker compose -f compose.yaml -f compose.scale.yaml run --rm --no-deps bootstrap npm run db:cleanup -w @ticketchain/api -- --all --apply --writers-stopped --confirm-all TICKETCHAIN_DEMO
```

After cleanup, verify by repeating the selected command without `--apply`, then restart the stack:

```bash
docker compose -f compose.yaml -f compose.scale.yaml up -d --wait
```
