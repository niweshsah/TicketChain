# Single-server demo on Oracle Cloud

TicketChain runs on one server with separate Docker images for Identity, Booking,
Payments, Catalog, and the web UI. Each API and each worker runs once. PostgreSQL,
Redis, RabbitMQ, Elasticsearch, MinIO, and the HTTPS edge remain separate containers.
The APIs retain their separate databases. Simulated INR purchases and refunds charge
no money. OAuth and wallet controls are disabled in this deployment.

## Create the server

Create an Oracle Always Free Ubuntu 24.04 ARM VM in your home region, using the
`VM.Standard.A1.Flex` shape with 2 OCPUs, 12 GB RAM, and a 100 GB boot disk. Check
that the console marks the resources Always Free eligible before creating them.
Oracle currently documents 200 GB total free boot/block storage; availability varies,
and idle instances can be reclaimed. This is a small demo, without an uptime guarantee.
See [Oracle's current limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Assign a public IPv4 address. In both the Oracle network security rules and the Ubuntu
firewall, allow inbound TCP 80 and 443 from the internet, and TCP 22 only from your
administration IP. Leave database, broker, storage, and API ports closed. Keep outbound
DNS and HTTPS available for Docker pulls, certificates, and updates.

Install Docker Engine and Compose **2.24.4 or newer**, following the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Install Node.js 22 or newer for the deployment helper. Copy the project to the VM,
excluding `.env*`, `.runtime`, `node_modules`, `.git`, and local database files.
The server gets its own fresh database; your development database is not transferred.

Local test results are recorded in [deployment verification](demo-hosting-verification.md).

## Configure and start

From the project root, substitute the VM's real public IPv4 address:

```bash
node apps/api/scripts/deployment/demo.mjs init YOUR_PUBLIC_IPV4
node apps/api/scripts/deployment/demo.mjs config
node apps/api/scripts/deployment/demo.mjs up
node apps/api/scripts/deployment/demo.mjs verify
```

`init` creates an owner-readable `.env.demo` with random credentials. It refuses to
overwrite an existing file. Save a secure copy of this file off the server. The helper
always uses Docker project **ticketchain-demo**, the root `compose.yaml`, and the demo
override. Do not add `compose.scale.yaml`. It does not use or change the local stack's
volumes. Docker builds share layers, while the four API images have distinct tags and
service entrypoints. The first ARM build and database bootstrap can take several minutes.

The URL will be `https://ticketchain.YOUR_PUBLIC_IPV4.sslip.io`. No domain purchase is
required: [sslip.io resolves the IP embedded in the hostname](https://nip.io/).
[Caddy automatically obtains and renews HTTPS certificates](https://caddyserver.com/docs/automatic-https).
The HTTP port is used for certificate validation and redirects to HTTPS. If issuance is
temporarily rate limited, inspect the edge logs and retry later; do not repeatedly recreate
certificate storage. Keep the VM IP stable, because changing it changes this hostname.

Wait for Catalog's first projection refresh before `verify` if discovery is initially
empty. The verifier checks exactly one healthy instance of every runtime service and
the public HTTPS routes. It does not bypass certificate validation.

Use `attendee@demo.ticketchain.local` or `organizer@demo.ticketchain.local` with the
`DEMO_ACCOUNT_PASSWORD` saved in `.env.demo`, or register a new account in the UI.
The generated password is intentionally not printed or embedded in the frontend.
Share it separately with demo visitors if needed. Editing this setting later does not
reset existing accounts, and changing database secrets requires a coordinated rotation.

The deployment uses `NODE_ENV=production`, `PAYMENT_PROVIDER=demo`, and the explicit
`ALLOW_DEMO_PAYMENTS=true` opt-in. Production simulated payments otherwise remain
blocked, including delayed captures and refunds. Checkout identifies the simulated
payment before confirmation. Do not configure live payment keys or testnet wallet keys
in this demo stack. Existing local development behavior remains unchanged.

## Verify the UI and operate the stack

Manually check desktop and mobile: registration/login, session refresh, city and artist
search, event details, avatar upload/removal, publishing, tier removal/retirement,
purchase, admission tickets, and refund. Event information and edited values must survive
failed requests; unconfigured social login options must remain disabled.

Run the browser journeys from a development machine with dependencies and Playwright's
Chromium installed. Set `E2E_DEMO_PASSWORD` privately to the generated demo password:

```bash
E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=https://YOUR_DEMO_HOSTNAME npm run test:e2e
```

Browser-created events have explicit markers and are cancelled by test cleanup. Tests
change demo inventory and create test accounts; run them against the demo, not live sales.
Public HTTPS tests must use normal certificate verification. `E2E_LOCAL_TLS=true` is
only for local testing with an internal CA, not a public deployment.

```bash
node apps/api/scripts/deployment/demo.mjs status
node apps/api/scripts/deployment/demo.mjs up
```

For logs or resource measurements, use the same project and environment explicitly:

```bash
docker compose --env-file .env.demo -p ticketchain-demo -f compose.yaml -f compose.demo.yaml logs --tail 100 edge payments catalog-worker
docker stats --no-stream
```

After updates, run `up`, `verify`, and the affected browser journeys. Startup applies
additive migrations and preserves existing service records, IDs, sessions, and inventory.
Back up before updating. Observe memory, disk use, and latency on the VM; this configuration
has not been load-tested for large audiences. Observability and validation containers are
not started by default.

## Back up and restore

```bash
node apps/api/scripts/deployment/demo.mjs backup
```

Backup pauses the demo, dumps all five databases, stops infrastructure, and archives
avatar objects, both RSA key volumes, broker/cache/search state, source snapshots, and
Caddy certificate/configuration data. It restarts runtime services in `finally`. The
owner-readable backup directory is printed; copy it and `.env.demo` to private storage
outside the VM. Treat backups as sensitive account and authentication data.

Restore into a server with the same project version, original `.env.demo`, and images
built using `node apps/api/scripts/deployment/demo.mjs build`:

```bash
node apps/api/scripts/deployment/demo.mjs restore /ABSOLUTE/BACKUP_PATH TICKETCHAIN_DEMO
node apps/api/scripts/deployment/demo.mjs verify
```

The explicit confirmation permits replacing only the demo project's data. Restore
validates the complete backup and matching configuration before stopping services. It
restores schemas, IDs, credentials, sessions, uploaded images, and persistent volumes.
If restore fails, keep the stack offline, fix the reported problem, and rerun with the
same complete backup. Never use `docker compose down -v` as an update or restore step.

Actual Oracle provisioning and public browser verification require access to your VM.
Local verification can use `TC_DEMO_ENV_FILE` and `TC_DEMO_OVERRIDE_FILE` pointing to
ignored files for an isolated localhost HTTPS edge; the default public configuration
always uses `.env.demo` and publicly trusted TLS.
