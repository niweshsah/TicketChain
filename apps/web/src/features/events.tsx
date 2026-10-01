import { DiscoveryFilters } from './DiscoveryFilters';
import { useBrowsingCity } from '../CitySelect';
import { EventImage } from '../EventImage';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { money, cities, type EventDto } from '@ticketchain/shared';
import { ticketApi as api } from '../store';
import { useReducedMotion } from '../theme';
import { Notice, date } from './feedback';
const Microphone = lazy(() => import('../Microphone'));
function Cards({ events }: { events: EventDto[] }) {
  return (
    <div className="cards">
      {events.map((e) => (
        <article className="event-card" key={e.id}>
          <Link to={`/events/${e.id}`}>
            <EventImage src={e.image_url} alt={e.title} loading="lazy" />
            <div className="card-body">
              <span className="eyebrow">
                {e.category} · {e.city}
              </span>
              <h3>{e.title}</h3>
              <p className="card-date">{date(e.starts_at, e.timezone)}</p>
              <p>{e.venue}</p>
              <div className="card-bottom">
                <strong>
                  From {money(Math.min(...e.tiers.map((t) => t.price_paise)))}
                </strong>
                <span className="pill">
                  {e.tiers.some((t) => t.available > 0)
                    ? 'Get tickets ↗'
                    : 'Sold out'}
                </span>
              </div>
            </div>
          </Link>
        </article>
      ))}
    </div>
  );
}
export function Home() {
  const [city] = useBrowsingCity();
  const { data, error, isLoading } = api.useDiscoverQuery(
    `limit=6&city=${encodeURIComponent(city)}`,
  );
  const events = data?.events || [];
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (paused || hover || reduced || events.length < 2) return;
    const t = setInterval(() => setSlide((i) => (i + 1) % events.length), 6000);
    return () => clearInterval(t);
  }, [paused, hover, reduced, events.length]);
  const e = events[slide % (events.length || 1)];
  return (
    <>
      <section
        className="hero"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget)) setHover(false);
        }}
      >
        {e && <EventImage className="hero-image" src={e.image_url} alt="" />}
        <div className="hero-content">
          <span className="eyebrow">THE NIGHT IS YOURS</span>
          <h1>
            Less scrolling.
            <br />
            <span>More living.</span>
          </h1>
          <p>
            Your favorite artists. Your kind of crowd.
            <br />
            Find the moments you’ll talk about tomorrow.
          </p>
          <Link className="button" to={e ? `/events/${e.id}` : '/events'}>
            {e
              ? `Experience ${e.title.split(' · ')[0]} ↗`
              : 'Discover events ↗'}
          </Link>
          {e && (
            <p className="hero-meta">
              {e.city} · {date(e.starts_at, e.timezone)}
            </p>
          )}
        </div>
        {events.length > 1 && (
          <div className="carousel-controls">
            <button
              aria-label="Previous event"
              onClick={() =>
                setSlide((slide - 1 + events.length) % events.length)
              }
            >
              ←
            </button>
            <span>
              {(slide % events.length) + 1} / {events.length}
            </span>
            <button
              aria-label="Next event"
              onClick={() => setSlide((slide + 1) % events.length)}
            >
              →
            </button>
            <button
              aria-label={paused ? 'Resume carousel' : 'Pause carousel'}
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Play' : 'Pause'}
            </button>
          </div>
        )}
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAKE A PLAN</span>
            <h2>Coming to your city</h2>
          </div>
          <Link to="/events">See all events ↗</Link>
        </div>
        {isLoading && <p role="status">Finding your next night out…</p>}
        <Notice error={error} />
        {!isLoading && !error && !events.length && (
          <p>No published events yet. Check back soon.</p>
        )}
        <Cards events={events} />
      </section>
      <section className="feature panel">
        <div>
          <span className="eyebrow">TAKE CENTER STAGE</span>
          <h2>
            A great show starts
            <br />
            with <span>your idea.</span>
          </h2>
          <p>Create an event, open the doors, and bring people together.</p>
          <Link className="button" to="/organizer">
            Create your event ↗
          </Link>
        </div>
        <Suspense fallback={<div className="mic-fallback">🎙</div>}>
          <Microphone />
        </Suspense>
      </section>
    </>
  );
}
export function Discovery() {
  const [params, setParams] = useSearchParams();
  const [city, setCity] = useBrowsingCity();
  useEffect(() => {
    const selected = params.get('city');
    if (
      selected !== null &&
      selected !== city &&
      (selected === '' || cities.includes(selected as (typeof cities)[number]))
    )
      setCity(selected);
  }, [params, city, setCity]);
  const {
    currentData: data,
    error,
    isFetching,
  } = api.useDiscoverQuery(
    params.has('city')
      ? params.toString()
      : `${params.toString()}&city=${encodeURIComponent(city)}`,
  );
  return (
    <section className="section">
      <span className="eyebrow">FIND YOUR FREQUENCY</span>
      <h1>Discover events</h1>
      <div className="category-chips">
        {[
          'Concert',
          'Festival',
          'Comedy',
          'Jazz',
          'Acoustic',
          'Electronic',
        ].map((c) => (
          <button
            key={c}
            aria-pressed={params.get('category') === c}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('category', params.get('category') === c ? '' : c);
              next.delete('page');
              setParams(next);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <DiscoveryFilters
        key={`${params.toString()}:${params.get('city') ?? city}`}
        query={params.toString()}
        city={city}
        onApply={(next) => setParams(next)}
      />
      <Notice error={error} />
      {isFetching && <p role="status">Loading events…</p>}
      {data && !data.events.length && (
        <div className="panel">
          No events match these filters. Try another city or search.
        </div>
      )}
      {data && <Cards events={data.events} />}
      <div className="actions">
        <button
          disabled={Number(params.get('page') || 1) <= 1 || isFetching}
          onClick={() => {
            params.set('page', String(Number(params.get('page') || 1) - 1));
            setParams(params);
          }}
        >
          Previous page
        </button>
        <span>Page {params.get('page') || 1}</span>
        <button
          disabled={(data?.events.length || 0) < 20 || isFetching}
          onClick={() => {
            params.set('page', String(Number(params.get('page') || 1) + 1));
            setParams(params);
          }}
        >
          Next page
        </button>
      </div>
    </section>
  );
}
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
            {date(e.starts_at, e.timezone)} — {date(e.ends_at, e.timezone)}
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
