import { DiscoveryFilters } from '../DiscoveryFilters';
import { useBrowsingCity } from '../../CitySelect';
import { EventImage } from '../../EventImage';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { money, cities, type EventDto } from '@ticketchain/shared';
import { ticketApi as api } from '../../store';
import { useReducedMotion } from '../../theme';
import { Notice, date } from '../feedback';
export function Details({ preview = false }: { preview?: boolean }) {
  const { id = '' } = useParams();
  const publicQuery = api.useEventQuery(id, { skip: preview });
  const previewQuery = api.usePreviewQuery(id, { skip: !preview });
  const { data: e, error, isLoading } = preview ? previewQuery : publicQuery;
  if (isLoading) return <p role="status">Loading event…</p>;
  if (!e) return <Notice error={error} />;
  return (
    <section className="section">
      <Link to={preview ? '/organizer' : '/events'}>
        ← {preview ? 'Organizer dashboard' : 'All events'}
      </Link>
      {preview && <Notice>Preview · {e.status}</Notice>}
      <div className="detail-hero">
        <EventImage src={e.image_url} alt={e.title} />
        <div>
          <span className="eyebrow">
            {e.category} · {e.city}
          </span>
          <h1>{e.title}</h1>
          <p>
            {date(e.starts_at, e.timezone)}
            {e.ends_at !== e.starts_at && ` — ${date(e.ends_at, e.timezone)}`}
          </p>
          <p>
            {e.venue} · {e.timezone}
          </p>
          <Link
            className="button"
            to={preview ? `/organizer/${id}/edit` : `/checkout/${id}`}
          >
            {preview
              ? 'Edit event'
              : e.tiers.some((t) => t.available > 0)
                ? 'Choose your tickets ↗'
                : 'View sold-out tiers'}
          </Link>
        </div>
      </div>
      <div className="detail-grid">
        <article className="panel">
          <h2>About the experience</h2>
          <p className="description">
            {e.description || 'Description unspecified'}
          </p>
          <h2>Performers</h2>
          <p>{e.performers?.join(' · ') || 'Unspecified'}</p>
          <h2>Venue and entry</h2>
          <p>{e.venue_address || 'Address unspecified'}</p>
          <p>
            {e.entry_at
              ? `Entry from ${date(e.entry_at, e.timezone)}`
              : 'Entry time unspecified'}
          </p>
          <h2>Audience information</h2>
          <p>Languages: {e.languages?.join(' · ') || 'Unspecified'}</p>
          <p>Age policy: {e.age_policy || 'Unspecified'}</p>
          <p>Accessibility: {e.accessibility_notes || 'Unspecified'}</p>
        </article>
        <aside className="panel booking-panel">
          <h2>Your way in</h2>
          {e.tiers.map((t) => (
            <div className="tier" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <p>{t.available} available</p>
                <p>{t.inclusions?.join(' · ') || 'Inclusions unspecified'}</p>
              </div>
              <strong>{money(t.price_paise)}</strong>
            </div>
          ))}
          <Link
            className="button booking-action"
            to={preview ? `/organizer/${id}/edit` : `/checkout/${id}`}
          >
            {preview ? 'Edit event' : 'Book tickets'}
          </Link>
          <p>Whole-order refunds before start, while all tickets are unused.</p>
        </aside>
      </div>
    </section>
  );
}
