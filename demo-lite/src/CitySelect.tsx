import { useSyncExternalStore } from 'react';
import { cities } from '@ticketchain/shared';
import { useSelector } from 'react-redux';
import type { RootState } from './store';
export function CitySelect({
  value,
  onChange,
  name,
  emptyLabel = 'All cities',
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="city-control">
      <select
        aria-label="City"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {cities.map((city) => (
          <option key={city}>{city}</option>
        ))}
      </select>
    </div>
  );
}
function subscribe(callback: () => void) {
  window.addEventListener('citychange', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('citychange', callback);
    window.removeEventListener('storage', callback);
  };
}
export function useBrowsingCity() {
  const home = useSelector((s: RootState) => s.auth.user?.homeCity);
  const explicit = useSyncExternalStore(subscribe, () =>
    localStorage.getItem('browsingCity'),
  );
  const city = explicit === null ? home || '' : explicit;
  return [
    cities.includes(city as (typeof cities)[number]) ? city : '',
    (value: string) => {
      localStorage.setItem('browsingCity', value);
      window.dispatchEvent(new Event('citychange'));
    },
  ] as const;
}
