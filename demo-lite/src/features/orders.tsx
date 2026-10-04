import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { money } from '@ticketchain/shared';
import { ticketApi as api, type RootState } from '../store';
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
        <p>No online payment is collected. Maximum ten tickets per order.</p>
        <div className="total">
          <span>{count} tickets</span>
          <strong>{money(total.toString(), currency)}</strong>
        </div>
        {!count && (
          <Notice>Choose a quantity above zero to book tickets.</Notice>
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
          {mutation.isLoading ? 'Reserving…' : 'Confirm booking ↗'}
        </button>
      </div>
    </section>
  );
}

export { Confirmation } from './orders/Confirmation';
