# Provider configuration and boundaries

INR amounts are integer paise. APT amounts are bigint octas, serialized as decimal JSON strings. There is no implicit conversion and no fixed service fee. One event and at most ten tickets are supported per order.

## Demo

`PAYMENT_PROVIDER=demo` is explicit local development configuration. Success, failure, delayed capture and uncertain outcomes exercise the same allocation, admission, refund and job services. Demo fails startup in production. Payment uncertainty enters visible manual review. No real money is charged.

## Razorpay test mode

Set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID=rzp_test_...`, key secret, and webhook secret. Invalid configuration fails startup without fallback. Initialize a provider order server-side, then open Standard Checkout using that stored order ID. The API verifies the checkout HMAC, fetches the payment, and requires captured status plus exact association, currency and amount before fulfillment. It never trusts client-supplied prices or an unverified checkout callback.

Raw webhook middleware precedes JSON parsing. Signature validation uses the original bytes, provider event IDs are deduplicated, and ingestion plus reconciliation jobs commit before acknowledgement. Workers fetch current provider state; older or duplicate notifications cannot regress captured/refunded outcomes. Extra captures are refunded without additional tickets. Ambiguous provider order creation requires review by receipt; uncertain refunds reconcile the provider's refund list by persisted operation reference.

Razorpay API calls use a 15-second timeout. Provider outages and API limits affect confirmation latency and the durable backlog. There is no assumption of exactly-once network delivery. Amount and currency checks follow [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/) and [webhook validation](https://razorpay.com/docs/webhooks/validate-test/).

## Aptos testnet and collectibles

APT appears only for explicitly priced tiers and linked wallets; the server also requires configured treasury. Normal INR payment remains the default. Linking uses an expiring, single-use challenge binding user, address, application origin and chain ID 2. Only unrotated standard Ed25519 accounts are accepted; multisig, keyless, rotated-key and other schemes are rejected explicitly.

Transfer verification requires a successful committed testnet `0x1::aptos_account::transfer`, the linked sender, exact treasury recipient and octas, creation within the order's hold window, and a globally unique hash. Follow the [Aptos integration guide](https://aptos.dev/build/guides/application-integration). The current UI accepts a committed transaction hash after the wallet transfer; it does not automatically initiate a wallet transfer.

Refunds return original paid octas to the original verified sender. Treasury submissions are serialized using a PostgreSQL advisory transaction and durable pending-operation state. Signed transaction bytes, locally derived hash, sequence and expiration are persisted before submission. Recovery queries the same hash and resubmits only the same bytes while valid. Unresolved/expired transactions require manual financial review before any replacement.

Set `APTOS_TREASURY`, `APTOS_PRIVATE_KEY`, and `APTOS_MODULE` for optional blockchain work. Never commit the treasury key. Publish the module using Aptos CLI 9.6.0, with named address `ticketchain` set to the treasury address. Framework dependencies are pinned by commit. The module creates named digital assets keyed by ticket ID, permits only the treasury to mint, and tracks minted identities to prevent duplication. The three local Move tests cover authorization and repeated mint attempts.

One claim is accepted per eligible paid ticket and snapshots the linked recipient. Claims survive subsequent wallet relinking. Collectibles can remain after refund or on-chain transfer; database admission remains authoritative. Live payment, refund, wallet-provider compatibility and on-chain claim checks require test credentials/accounts and must be reported separately from fixture and Move tests.
