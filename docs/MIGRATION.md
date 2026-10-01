# Migration, backup and recovery

Existing migrations are retained byte-for-byte. New migrations add `tc_*` tables and an immutable legacy archive without resetting, dropping or rewriting legacy tables. Use separately named databases for the source, demo and tests. Do not point seeds, contention or integration tests at the source.

Before import, take a PostgreSQL custom-format backup using `pg_dump --format=custom` and a read-only source account. Test `pg_restore` into a separate database, and retain the backup outside the repository. For operational recovery, restore the database first, then restart API/workers: leases recover abandoned jobs, persisted provider identifiers reconcile external effects, and terminal payment states remain terminal. Never erase financial operation data to force a retry.

## Explicit legacy import

```sh
# The export contains password hashes and private historical records. Protect it.
LEGACY_DATABASE_URL='read-only-source-url' npm run legacy -w @ticketchain/api -- export /private/tmp/legacy.json
npm run legacy -w @ticketchain/api -- dry-run /private/tmp/legacy.json /private/tmp/mapping.json /private/tmp/report.json
# Only after reviewing the report and verifying the backup:
ALLOW_LEGACY_IMPORT=yes npm run legacy -w @ticketchain/api -- import /private/tmp/legacy.json /private/tmp/mapping.json /private/tmp/import-report.json
npm run legacy -w @ticketchain/api -- verify /private/tmp/legacy.json /private/tmp/mapping.json /private/tmp/verification.json
```

Mapping example, with actual legacy IDs substituted:

```json
{
  "currencyByTier": { "tier-uuid": "INR" },
  "minorUnitByTier": { "tier-uuid": "paise" },
  "timezoneByEvent": { "event-uuid": "Asia/Kolkata" },
  "paymentEvidenceByOrder": {
    "order-uuid": {
      "provider": "razorpay",
      "paymentId": "pay_provider_id",
      "currency": "INR",
      "amount": "149900",
      "verifiedAt": "2026-09-30T00:00:00.000Z",
      "reference": "provider reconciliation evidence"
    }
  }
}
```

The operator must verify payment evidence against the provider before entering the mapping. The importer checks exact snapshot totals and does not treat `sold`, `minted`, or a legacy order status as proof of payment. It performs no currency conversion. INR/paise imports are supported; other currencies and ambiguous APT legacy values remain archived with reasons and need a dedicated reviewed mapping before admission migration.

Account IDs and original password hashes are preserved. Unsupported roles/hashes create inactive accounts. All previously unverified wallets remain unlinked. Valid historical events import as drafts for organizer review; invalid dates remain in the archive only. Resolved orders preserve IDs and ticket identities; ambiguous orders remain in manual review with blocked admission when their structure is mappable. Original records, including unsupported/mixed-event records and reservations, are always archived verbatim. Historical holds are not revived. Conflicting target IDs/emails or reused units fail the import transaction; there is no silent merge or destructive reset. Repeating an import is rejected and directs the operator to verification.

Export, mapping, and reports use restricted filesystem permissions. Keep them out of git. For large legacy datasets, the current all-or-nothing importer should run in a controlled maintenance window; its transaction timeout and per-record SQL make it unsuitable for an unbounded online migration.

## Operations

`npm run ops -w @ticketchain/api -- list` lists due, running and review jobs. `retry JOB_ID RECONCILIATION_REFERENCE` retries only a reviewed job, preserves all external transaction data, and refuses ambiguous payment initialization. Reconcile initialization by provider receipt, verify association/amount/currency, and attach the provider order ID through a reviewed database operation before marking it ready. APT transactions retain signed bytes, hash, sequence and expiration; expired or uncertain submissions must be reconciled rather than automatically rebuilt.

`/health/live` reports process liveness. `/health/ready` checks the migrated schema and database. `/metrics` exposes bounded status labels, inventory conflicts, backlog age and a worker heartbeat. Local metrics are intended for the internal Compose network; apply deployment access controls before exposing them publicly.

For uncertain local demo payments only, `resolve-demo JOB_ID RECONCILIATION_REFERENCE success|failure` records the reviewed result. Success requeues the existing reconciliation job; failure leaves inventory held until expiry without issuing admission. Production providers cannot use this command.

## Migration to independently owned service databases

The previous `ticketchain_demo` database remains the preserved source. Bootstrap creates `_identity`, `_booking`, `_payments`, and `_catalog` databases with separate logins and service-owned tables. Booking account rows contain public profile projections with null password hashes. Payment order rows are financial snapshots. Original IDs, password hashes in Identity, session families, prices, inventory, allocations, provider identifiers, and issued tickets are retained.

Before initial cutover, pause the old API and workers, take a full PostgreSQL dump, and run the dry-run report. Bootstrap additionally saves a mode-0600 JSON snapshot to the `source-backups` volume before import. Import is transactional per target database and only populates empty targets. It does not overwrite targets, reset the source, or replay old financial jobs into both domains. Existing migration files stay unchanged.

```bash
SOURCE_DATABASE_URL=postgresql://ticketchain:localdemo@localhost:5432/ticketchain_demo npm run services:database -w @ticketchain/api -- dry-run
# Inside the bootstrap container, with its configured source URL:
node apps/api/dist/scripts/service-databases.js import
node apps/api/dist/scripts/service-databases.js verify
```

Verification checks original record identifiers, source/domain record counts, and uniqueness of current inventory allocation. Rebuild Catalog from Booking after import. Pause old writers throughout final transfer and only switch the gateway after verification. Rotating sessions continue against Identity; old HMAC access tokens may require refresh after the RSA cutover.

The source database remains untouched by service activity after cutover. New service writes mean automatic rollback to the old database would lose data; pause writers, export subsequent changes, reconcile them, and use an explicitly reviewed reverse migration. Restore all service databases and signing keys from a consistent backup set for recovery. Do not run `docker compose down -v` against preserved demo data.
