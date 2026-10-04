import { DiscoveryFilters } from '../DiscoveryFilters';
import { useBrowsingCity } from '../../CitySelect';
import { EventImage } from '../../EventImage';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { money, cities, type EventDto } from '@ticketchain/shared';
import { ticketApi as api } from '../../store';
import { useReducedMotion } from '../../theme';
import { Notice, date } from '../feedback';
const Microphone = lazy(() => import('../../Microphone'));
import { Cards } from './Cards';
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
