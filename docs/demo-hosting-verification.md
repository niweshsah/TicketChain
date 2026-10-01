# Demo deployment verification

Verified on October 1, 2026 using ARM64 Linux Docker containers on a local machine.
The isolated `ticketchain-demo` project used production Node settings, one instance
per API/worker, separate service images/databases, generated credentials, and an
HTTPS edge on localhost. Its local certificate authority was explicitly trusted
for Node's HTTPS verification; browser tests used the local TLS test setting.

- Lint, workspace type checking, and targeted formatting checks passed.
- All 16 unit tests passed, including production simulated-payment opt-in and
  rejection before creating a disabled demo payment operation.
- All 22 desktop/mobile browser journeys passed: registration/login, rotated
  sessions, discovery filters and pending search replacement, profile uploads,
  publication, tier retirement, purchases/refunds, admission check-in, waiting
  rooms, accessible forms, and narrow layouts.
- All six service journeys passed through HTTPS using the final service images:
  atomic holds/idempotency, capture/refund, concurrent waiting-room admission,
  search projection, uncertain payment protection, avatar processing, and
  retirement while preserving an existing payable hold.
- Every runtime service reported healthy, with exactly one container per service.
- Backup stopped and restarted the demo successfully. Restore recreated the
  containers and preserved captured account, session, listing, tier, inventory,
  purchase, provider-operation, and admission-ticket IDs. Avatar bytes and the
  RSA signing-key digest matched, and the original refresh session worked.
- Desktop/mobile screenshots were reviewed; automated checks found no horizontal
  overflow or WCAG A/AA violations on the inspected pages.

An idle/light-use resource sample totaled approximately **1.5 GB of container
memory**, including Elasticsearch. This is a local sample, not a load-test result
or a guarantee of Oracle VM performance. The existing local deployment remained
running separately throughout verification.

The test configuration, credentials, backups, and logs stay under ignored
`.runtime/`; public configuration uses `.env.demo` and the standard HTTPS ports.
No Oracle VM was provisioned and no public endpoint was verified: those steps
require the owner's VM access. Follow [the hosting instructions](DEMO_HOSTING.md)
and repeat verification at the actual public URL after provisioning.
