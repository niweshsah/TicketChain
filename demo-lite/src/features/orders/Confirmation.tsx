import { Link, useParams } from 'react-router-dom';
import { money } from '@ticketchain/shared';
import { ticketApi as api } from '../../store';
import { Notice } from '../feedback';
export function Confirmation() {
  const { id = '' } = useParams();
  const { data: order, error, isLoading } = api.useOrderQuery(id);
  if (!order)
    return isLoading ? (
      <p role="status">Loading your order…</p>
    ) : (
      <Notice error={error} />
    );
  return (
    <section className="section narrow">
      <span className="eyebrow">YOUR ORDER</span>
      <h1>
        {order.status === 'refunded'
          ? 'Refund confirmed.'
          : 'You’re on the list.'}
      </h1>
      <div className="panel">
        <h2>{order.event_title}</h2>
        <p className="pill">{order.status}</p>
        {order.items.map((item, index) => (
          <div className="tier" key={index}>
            <span>
              {item.quantity} × {item.tier_name}
            </span>
            <strong>
              {money(BigInt(item.price) * BigInt(item.quantity) + '')}
            </strong>
          </div>
        ))}
        <div className="total">
          <span>Total</span>
          <strong>{money(order.total)}</strong>
        </div>
        <p>No online payment was collected.</p>
        <Link className="button secondary" to="/account">
          View tickets and orders ↗
        </Link>
      </div>
    </section>
  );
}
