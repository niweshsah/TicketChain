# Validation evidence

Verified locally on October 1, 2026. The application runs at http://localhost:8080 with two replicas each of Identity, Booking, Payments, and Catalog, two Booking and Payments workers, and one Catalog worker. PostgreSQL 17, RabbitMQ, Redis, Elasticsearch and MinIO avatar storage run in separate containers. Reliability and contention tests use the designated test database; browser and service tests create disposable demo events and preserve order history.

| Check                                                                    | Result                              |
| ------------------------------------------------------------------------ | ----------------------------------- |
| Strict TypeScript across four workspaces                                 | Passed                              |
| Production builds and dedicated Linux images                             | Passed                              |
| ESLint and Prettier                                                      | Passed                              |
| Unit contracts and Aptos transfer fixtures                               | 14 passed                           |
| Isolated PostgreSQL/Redis reliability, legacy import, profile, and OAuth | 49 passed; 1 skipped                |
| Replicated microservice journeys                                         | 6 passed                            |
| Desktop/mobile browser journeys                                          | 20 passed                           |
| Dependency outage and recovery drills                                    | 3 passed                            |
| Pinned Move tests, CLI 9.6.0                                             | 3 passed                            |
| Production dependency audit                                              | 0 vulnerabilities                   |
| Original source database and record retention verification               | Passed                              |
| Live Google/GitHub consent and successful callback                       | Unverified; both clients configured |
| Live Razorpay capture/refund/webhook                                     | Unverified                          |
| Live Aptos transfers/refunds/collectible claims                          | Unverified                          |
| Physical camera and wallet signing interoperability                      | Unverified                          |
| Hosted GitHub Actions execution                                          | Unverified; workflow configured     |

The reliability suite covers atomic mixed-tier booking, overselling, expired-hold reuse, scoped idempotency, capture duplication/replay/reordering, late payments, refunds and check-in/cancellation, organizer authorization, date/price freezing, inventory retirement, refresh-token replay, raw webhook signatures, wallet forgery, recipient snapshots, and job lease recovery. Legacy import fixtures require explicit money, timezone, and payment mappings and preserve original IDs and hashes. Original migrations remain unchanged.

The service journeys verify asynchronous purchase/refund across service boundaries, waiting-room admission, search projection, internal-route isolation, and visible uncertain payments. Browser journeys verify purchase/refund, organizer publication and single-use check-in, profile editing and same-account organizer onboarding, preserved sign-in destinations, session logout, social controls, dark/mobile layout, carousel controls, and a second browser observing reduced inventory after a reservation.

The modular service refactor passed the full unit and isolated integration suites, all six replicated service journeys, and database-preservation verification after rebuilding and relaunching the containers. The final expanded browser suite passed all 20 desktop/mobile scenarios. A separate 50-page visual/accessibility audit covered desktop, tablet, mobile and 320-pixel layouts; see [UI review](ui-review.md). ESLint enforces service import boundaries and a 250-line limit for API modules and tooling. See [service code layout](service-layout.md).

## Measured contention

Each run used ten units in one tier with isolated disposable test data on Apple M5, 10 cores, 16 GiB RAM, and Docker PostgreSQL 17. Calls exercised the booking domain transaction directly, rather than measuring complete gateway throughput.

| Concurrent attempts        | Purchases | Inventory conflicts | Other failures | Duration  | p95 latency |
| -------------------------- | --------- | ------------------- | -------------- | --------- | ----------- |
| [10](contention-10.json)   | 10        | 0                   | 0              | 81.03 ms  | 79.56 ms    |
| [50](contention-50.json)   | 10        | 40                  | 0              | 194.96 ms | 189.85 ms   |
| [100](contention-100.json) | 10        | 90                  | 0              | 419.12 ms | 408.78 ms   |

All runs asserted ten active allocations and zero overselling. These measurements describe a small local dataset and do not establish production capacity.

## Recovery and preservation

Three real dependency drills passed: a captured payment survived stopping the Booking worker and restarting RabbitMQ (10.28 seconds); a Redis outage blocked queued reservations while existing orders remained readable (0.96 seconds); and an Elasticsearch outage used the Catalog database fallback and recovered after restart (2.82 seconds). The drill restores dependencies in a finally block. See the [service verification snapshot](service-verification.json).

Service bootstrap preserved the source database and transferred its original 3 accounts, 80 sessions, 1 OAuth identity, 41 event listings, 104 tiers, 39,280 inventory units, 16 orders, and 24 admission tickets. Subsequent tests add isolated demo records. Repeated bootstrap leaves populated service databases intact. Backups are ignored and owner-only; provider credentials remain in the ignored local environment. The eight distinct concert photographs are local assets with documented attribution.

Local dependencies are single-node deployments; API/worker replication demonstrates coordinated processing, not production high availability. Optional wallet and Three.js bundles are lazy loaded but still produce Vite size warnings. No paid hosting, real-money payment, or live blockchain transaction was performed. Google consent branding is managed in Google Cloud, outside this repository.
