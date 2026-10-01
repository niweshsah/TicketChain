# Service code layout

Each microservice owns a folder in `apps/api/src/services`. Keep HTTP parsing in `http/`, business rules in domain modules, and asynchronous work in `jobs.ts` and `messages.ts`.

| Service  | Main modules                                                                                              | Responsibility                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Identity | `auth`, `oauth/`, `avatars`, `wallet`, `http/`                                                            | Accounts, sessions, profile images, sign-ins and wallet proof                     |
| Booking  | `events/`, `orders/`, `waiting-room`, `collectibles`, `http/`                                             | Event editing, ticket inventory, reservations, fulfillment, refunds and admission |
| Payments | `initialization`, `confirmation`, `captures`, `reconciliation`, `refunds`, `razorpay/`, `aptos/`, `http/` | Provider operations, payment evidence and financial reconciliation                |
| Catalog  | `projection`, `search`, `rebuild`, `http/`                                                                | Discovery projections, cache and search indexing                                  |

Each folder has a `server.ts`. Booking, Payments and Catalog also have a `worker.ts`. Compose launches these service entry points directly. Run a built service with `npm run start:identity -w @ticketchain/api` (or `start:booking`, `start:payments`, `start:catalog`). Workers use `worker:booking`, `worker:payments` and `worker:catalog`. These commands need the corresponding service database and environment configuration from Compose.

`app.ts` composes middleware and service routers. Shared HTTP helpers provide authentication, rate limits, metrics, logging and error responses. `shared/infrastructure/` contains PostgreSQL jobs, Redis and RabbitMQ plumbing; `shared/workers/` coordinates scheduling and delivery. Business handlers stay with their owning service. `packages/shared` holds client/server contracts rather than database access.

Services communicate through authenticated internal HTTP and durable messages. ESLint rejects imports from another service's folder. The explicit `shared/standalone.ts` adapter supports local single-database development and isolated tests; it rejects calls in deployed service mode and loads the other domain only when called. Root `server.ts` and `worker.ts` retain this development entry point.

Runtime modules and API tooling are limited to 250 nonblank, noncomment lines by ESLint. Split new functionality by responsibility instead of bypassing this limit. Use descriptive names, keep transactions together when they protect inventory or payment consistency, and avoid adding business logic to route handlers or shared infrastructure.

Database startup tooling lives in `scripts/bootstrap/`: ownership lists, additive schema application and signing-key creation are separate from the command coordinator. Legacy import tooling lives in `scripts/legacy/`, with separate export, validation, event/inventory import, order import and verification modules. The API build clears generated output before compiling so moved modules cannot leave stale JavaScript behind.

Run `npm run lint`, `npm run typecheck`, `npm run build` and `npm test`. PostgreSQL integration tests use a separate `*_test` database. After rebuilding and starting Compose, run `npm run test:services` and the desktop/mobile Playwright journeys. See [architecture](architecture.md) for ownership and consistency guarantees and [profile and discovery interfaces](profiles-discovery.md) for the new feature contracts and storage backups.
