import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { money } from '@ticketchain/shared';
import { ticketApi as api, type RootState, type PaymentSetup } from '../store';
import { Notice, date } from './feedback';
export function Checkout() {
  const { id = '' } = useParams();
  const {
    data: e,
    error,
    isLoading,
  } = api.useEventQuery(id, {
    pollingInterval: 3000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const room = api.useWaitingRoomQuery(id, {
    skip: !e?.waiting_room,
    pollingInterval: 2000,
    skipPollingIfUnfocused: true,
  });
  const [join, joinState] = api.useJoinWaitingRoomMutation();
  const admitted =
    joinState.data?.state === 'admitted' && !room.data
      ? joinState.data
      : room.data;
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState<'INR' | 'APT'>('INR');
  const [createOrder, mutation] = api.useCreateOrderMutation();
  const navigate = useNavigate();
  const key = useRef({ fingerprint: '', value: crypto.randomUUID() });
  const user = useSelector((s: RootState) => s.auth.user);
  if (!e)
    return isLoading ? (
      <p role="status">Loading ticket availability…</p>
    ) : (
      <Notice error={error} />
    );
  const count = Object.values(quantities).reduce((a, b) => a + b, 0);
  const total = e.tiers.reduce(
    (sum, t) =>
      sum +
      BigInt(currency === 'INR' ? t.price_paise : t.price_octas || 0) *
        BigInt(quantities[t.id] || 0),
    0n,
  );
  async function reserve() {
    const body = {
      eventId: id,
      currency,
      ...(admitted?.pass ? { admissionPass: admitted.pass } : {}),
      items: Object.entries(quantities)
        .filter(([, n]) => n > 0)
        .map(([tierId, quantity]) => ({ tierId, quantity })),
    };
    const fingerprint = JSON.stringify({
      eventId: body.eventId,
      currency: body.currency,
      items: body.items,
    });
    if (key.current.fingerprint !== fingerprint)
      key.current = { fingerprint, value: crypto.randomUUID() };
    try {
      const order = await createOrder({
        body,
        key: key.current.value,
      }).unwrap();
      navigate(`/orders/${order.id}`);
    } catch {
      /* Mutation reports failure. */
    }
  }
  return (
    <section className="section narrow">
      <span className="eyebrow">YOU’RE ALMOST THERE</span>
      <h1>{e.title}</h1>
      <div className="panel">
        <h2>Choose your tickets</h2>
        {e.waiting_room && (
          <div className="notice">
            <strong>High-demand event · waiting room</strong>
            <p>
              {admitted?.state === 'admitted'
                ? 'Your turn! Reserve within two minutes. Admission does not guarantee ticket availability.'
                : admitted?.state === 'waiting'
                  ? `Your queue position: ${admitted.position}. Keep this page open.`
                  : 'Join the queue to get a reservation opportunity.'}
            </p>
            {admitted?.state !== 'admitted' &&
              admitted?.state !== 'waiting' && (
                <button
                  disabled={joinState.isLoading}
                  onClick={() =>
                    void join({ id, operation: 'join' })
                      .unwrap()
                      .then(() => room.refetch())
                      .catch(() => undefined)
                  }
                >
                  Join waiting room
                </button>
              )}
            {admitted?.state === 'waiting' && (
              <button
                disabled={joinState.isLoading}
                onClick={() =>
                  void join({ id, operation: 'leave' })
                    .unwrap()
                    .then(() => room.refetch())
                    .catch(() => undefined)
                }
              >
                Leave waiting room
              </button>
            )}
            <Notice error={room.error || joinState.error} />
          </div>
        )}
        {e.tiers.map((t) => (
          <div className="tier" key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <p>
                {money(
                  currency === 'INR' ? t.price_paise : t.price_octas || 0,
                  currency,
                )}{' '}
                · {t.available ? `${t.available} left` : 'Sold out'}
              </p>
            </div>
            <div className="quantity-control">
              <button
                type="button"
                aria-label={`Remove one ${t.name} ticket`}
                disabled={!quantities[t.id] || mutation.isLoading}
                onClick={() =>
                  setQuantities({
                    ...quantities,
                    [t.id]: Math.max(0, (quantities[t.id] || 0) - 1),
                  })
                }
              >
                −
              </button>
              <label>
                Quantity
                <input
                  type="number"
                  aria-label={`${t.name} quantity`}
                  min={0}
                  max={Math.min(10, t.available)}
                  value={quantities[t.id] || 0}
                  disabled={!t.available || mutation.isLoading}
                  onChange={(event) =>
                    setQuantities({
                      ...quantities,
                      [t.id]: Math.max(
                        0,
                        Math.min(
                          10,
                          t.available,
                          Number(event.target.value) || 0,
                        ),
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`Add one ${t.name} ticket`}
                disabled={
                  count >= 10 ||
                  (quantities[t.id] || 0) >= t.available ||
                  mutation.isLoading
                }
                onClick={() =>
                  setQuantities({
                    ...quantities,
                    [t.id]: (quantities[t.id] || 0) + 1,
                  })
                }
              >
                +
              </button>
            </div>
          </div>
        ))}
        <label>
          Pay with
          <select
            value={currency}
            onChange={(ev) => setCurrency(ev.target.value as 'INR' | 'APT')}
          >
            <option value="INR">
              {import.meta.env.VITE_PUBLIC_DEMO === 'true'
                ? 'INR · demo payment'
                : 'INR · normal payment'}
            </option>
            {import.meta.env.VITE_PUBLIC_DEMO !== 'true' &&
              user?.wallet &&
              e.tiers.every((t) => t.price_octas) && (
                <option value="APT">APT · testnet only</option>
              )}
          </select>
        </label>
        <Notice>
          {currency === 'INR'
            ? import.meta.env.VITE_PUBLIC_DEMO === 'true'
              ? 'Simulated INR payment. No real money is charged.'
              : 'Local development uses demo INR payments. No real money is charged. Razorpay, when configured, uses test mode.'
            : 'Aptos testnet only. Send the exact displayed amount from your linked wallet to the displayed treasury.'}
        </Notice>
        <p>Tickets are held for ten minutes. Maximum ten tickets per order.</p>
        <div className="total">
          <span>{count} tickets</span>
          <strong>{money(total.toString(), currency)}</strong>
        </div>
        {!count && (
          <Notice>Choose a quantity above zero to reserve tickets.</Notice>
        )}
        {count > 10 && (
          <Notice>Select no more than ten tickets in total.</Notice>
        )}
        <Notice error={mutation.error} />
        <button
          className="button"
          disabled={
            !count ||
            count > 10 ||
            mutation.isLoading ||
            (e.waiting_room && admitted?.state !== 'admitted') ||
            e.tiers.some((tier) => (quantities[tier.id] || 0) > tier.available)
          }
          onClick={() => void reserve()}
        >
          {mutation.isLoading ? 'Reserving…' : 'Reserve and continue ↗'}
        </button>
      </div>
    </section>
  );
}
interface RazorCheckout {
  open(): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorCheckout;
  }
}
export function Confirmation() {
  const { id = '' } = useParams();
  const { data: order, error } = api.useOrderQuery(id, {
    pollingInterval: 2000,
  });
  const [initialize, init] = api.useInitializeMutation();
  const [confirm, payment] = api.useConfirmMutation();
  const [setup, setSetup] = useState<PaymentSetup>();
  const [scenario, setScenario] = useState<
    'success' | 'failure' | 'delayed' | 'uncertain'
  >('success');
  const [hash, setHash] = useState('');
  const [localError, setLocalError] = useState<unknown>();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  async function prepare() {
    try {
      setSetup(await initialize(id).unwrap());
    } catch {
      /* Server error shown below. */
    }
  }
  useEffect(() => {
    if (!setup || !['intent', 'submitting'].includes(setup.status)) return;
    const t = setTimeout(() => {
      void initialize(id).unwrap().then(setSetup).catch(setLocalError);
    }, 1200);
    return () => clearTimeout(t);
  }, [setup, id, initialize]);
  async function pay() {
    if (!setup) return;
    setLocalError(undefined);
    try {
      if (setup.provider === 'razorpay') {
        setCheckoutOpen(true);
        if (!window.Razorpay)
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = () => resolve();
            script.onerror = () =>
              reject(new Error('Could not load Razorpay checkout'));
            document.head.appendChild(script);
          });
        if (!window.Razorpay) throw new Error('Checkout unavailable');
        new window.Razorpay({
          key: setup.keyId,
          order_id: setup.providerOrderId,
          amount: setup.amount,
          currency: setup.currency,
          name: 'TicketChain · Test',
          modal: { ondismiss: () => setCheckoutOpen(false) },
          handler: (evidence: {
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            setCheckoutOpen(false);
            void confirm({
              orderId: id,
              scenario: 'success',
              paymentId: evidence.razorpay_payment_id,
              signature: evidence.razorpay_signature,
            })
              .unwrap()
              .catch(setLocalError);
          },
        }).open();
      } else
        await confirm({
          orderId: id,
          scenario,
          ...(setup.provider === 'aptos' ? { transactionHash: hash } : {}),
        }).unwrap();
    } catch (e) {
      setCheckoutOpen(false);
      setLocalError(e);
    }
  }
  if (!order) return <Notice error={error} />;
  return (
    <section className="section narrow">
      <span className="eyebrow">YOUR ORDER</span>
      <h1>
        {order.status === 'paid'
          ? 'You’re on the list.'
          : order.status === 'refunded'
            ? 'Refund confirmed.'
            : 'One step closer.'}
      </h1>
      <div className="panel">
        <h2>{order.event_title}</h2>
        <p className="pill">{order.status.replaceAll('_', ' ')}</p>
        {order.items.map((i, n) => (
          <div className="tier" key={n}>
            <span>
              {i.quantity} × {i.tier_name}
            </span>
            <strong>
              {money(
                (BigInt(i.price) * BigInt(i.quantity)).toString(),
                order.currency,
              )}
            </strong>
          </div>
        ))}
        <div className="total">
          <span>Total</span>
          <strong>{money(order.total, order.currency)}</strong>
        </div>
        {order.status === 'held' && (
          <>
            <p>
              Hold expires {date(order.expires_at)}. Refreshing this page keeps
              your order.
            </p>
            {!setup ? (
              <button
                className="button"
                disabled={init.isLoading}
                onClick={() => void prepare()}
              >
                Continue to payment
              </button>
            ) : (
              <>
                <Notice>
                  {setup.provider === 'demo'
                    ? 'DEMO PAYMENT · no real funds charged'
                    : setup.provider === 'razorpay'
                      ? 'RAZORPAY TEST MODE · use test credentials'
                      : 'APTOS TESTNET · admission is confirmed by the server'}
                </Notice>
                {setup.provider === 'demo' && (
                  <label>
                    Demo outcome
                    <select
                      value={scenario}
                      onChange={(ev) =>
                        setScenario(ev.target.value as typeof scenario)
                      }
                    >
                      <option value="success">Success</option>
                      <option value="failure">Failure</option>
                      <option value="delayed">Delayed confirmation</option>
                      <option value="uncertain">
                        Uncertain · manual review
                      </option>
                    </select>
                  </label>
                )}
                {setup.provider === 'aptos' && (
                  <>
                    <p>
                      Send {money(setup.amount, 'APT')} to{' '}
                      <code>{setup.treasury}</code>
                    </p>
                    <label>
                      Committed transaction hash
                      <input
                        value={hash}
                        onChange={(ev) => setHash(ev.target.value)}
                        placeholder="0x…"
                      />
                    </label>
                  </>
                )}
                <button
                  className="button"
                  disabled={
                    payment.isLoading ||
                    checkoutOpen ||
                    !['ready', 'captured'].includes(setup.status)
                  }
                  onClick={() => void pay()}
                >
                  {setup.status === 'intent'
                    ? 'Preparing payment…'
                    : payment.isLoading
                      ? 'Verifying…'
                      : 'Pay and confirm'}
                </button>
              </>
            )}
          </>
        )}
        {payment.data?.status === 'payment_pending' && (
          <Notice>
            Payment confirmation is pending. Your order will update
            automatically. Uncertain results are held for financial review.
          </Notice>
        )}
        {order.status === 'refund_pending' && (
          <Notice>
            Refund accepted. Admission is blocked while the provider confirms
            your refund.
          </Notice>
        )}
        {(order.status === 'manual_review' || order.financial_review) && (
          <Notice>
            Financial resolution needs manual review. Admission remains blocked.
          </Notice>
        )}
        {order.status === 'expired' && (
          <Notice>
            Your hold expired. Any late captured payment will be reallocated in
            full or refunded.
          </Notice>
        )}
        <Notice error={init.error || payment.error || localError} />
        <Link className="button secondary" to="/account">
          View tickets and orders ↗
        </Link>
      </div>
    </section>
  );
}
