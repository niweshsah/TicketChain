import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { TicketDto } from '@ticketchain/shared';
import { money } from '@ticketchain/shared';
import { ticketApi as api } from '../store';
import { Notice } from './feedback';
import { SocialAuth } from './social-auth';

function Ticket({ ticket }: { ticket: TicketDto }) {
  const [show, setShow] = useState(false);
  const qr = api.useQrQuery(ticket.id, {
    skip: !show || ticket.status !== 'valid' || ticket.order_status !== 'paid',
  });
  const [copied, setCopied] = useState(false);
  function download() {
    const svg = document.getElementById(`qr-${ticket.id}`);
    if (!svg) return;
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: 'image/svg+xml',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ticketchain-ticket.svg';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <article className="panel ticket">
      <span className="eyebrow">{ticket.tier_name}</span>
      <h3>{ticket.event_title}</h3>
      <p>
        {ticket.status.replaceAll('_', ' ')} · order{' '}
        {ticket.order_status.replaceAll('_', ' ')}
      </p>
      {ticket.status === 'valid' && ticket.order_status === 'paid' && (
        <button onClick={() => setShow(!show)}>
          {show ? 'Hide admission code' : 'Show admission code'}
        </button>
      )}
      {show &&
        ticket.status === 'valid' &&
        ticket.order_status === 'paid' &&
        qr.data && (
          <div className="qr">
            <QRCodeSVG
              id={`qr-${ticket.id}`}
              value={qr.data.code}
              size={180}
              level="M"
            />
            <code>{qr.data.code}</code>
            <div className="actions">
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(qr.data!.code)
                    .then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy manual code'}
              </button>
              <button onClick={download}>Download QR</button>
            </div>
          </div>
        )}
      <Notice error={qr.error} />
    </article>
  );
}
export function Account() {
  const tickets = api.useTicketsQuery(undefined, { pollingInterval: 3000 });
  const orders = api.useOrdersQuery(undefined, { pollingInterval: 3000 });
  const [refund, mutation] = api.useRefundMutation();
  return (
    <section className="section">
      <span className="eyebrow">YOUR EXPERIENCES</span>
      <h1>Tickets & memories</h1>
      <Notice error={tickets.error || orders.error || mutation.error} />
      {tickets.isLoading && <p role="status">Loading tickets…</p>}
      <div className="cards">
        {tickets.data?.map((t) => (
          <Ticket key={t.id} ticket={t} />
        ))}
      </div>
      {!tickets.isLoading && !tickets.data?.length && (
        <div className="panel">
          <p>Your next great night is waiting.</p>
          <Link to="/events">Find an event ↗</Link>
        </div>
      )}
      <h2>Order history</h2>
      <div className="panel">
        {orders.data?.map((o) => (
          <div className="tier" key={o.id}>
            <div>
              <Link to={`/orders/${o.id}`}>
                <strong>{o.event_title}</strong>
              </Link>
              <p>
                {o.status.replaceAll('_', ' ')} · {money(o.total, o.currency)}
              </p>
            </div>
            {o.status === 'paid' && (
              <button
                disabled={mutation.isLoading}
                onClick={() => {
                  void refund(o.id)
                    .unwrap()
                    .catch(() => undefined);
                }}
              >
                Request full refund
              </button>
            )}
          </div>
        ))}
        {!orders.data?.length && <p>No orders yet.</p>}
      </div>
      <div className="panel">
        <SocialAuth linking />
      </div>
    </section>
  );
}
