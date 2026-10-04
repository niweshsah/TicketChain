import { DiscoveryFilters } from '../DiscoveryFilters';
import { useBrowsingCity } from '../../CitySelect';
import { EventImage } from '../../EventImage';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { money, cities, type EventDto } from '@ticketchain/shared';
import { ticketApi as api } from '../../store';
import { useReducedMotion } from '../../theme';
import { Notice, date } from '../feedback';
import { Cards } from './Cards';
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
