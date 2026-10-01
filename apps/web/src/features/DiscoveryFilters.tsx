import { useState, type FormEvent } from 'react';
import { categories } from '@ticketchain/shared';
import { CitySelect } from '../CitySelect';

type Filters = {
  q: string;
  city: string;
  category: string;
  sort: string;
  available: boolean;
};
function readFilters(query: string, city: string): Filters {
  const params = new URLSearchParams(query);
  return {
    q: params.get('q') || '',
    city: params.get('city') ?? city,
    category: params.get('category') || '',
    sort: params.get('sort') || 'date',
    available: params.get('available') === 'true',
  };
}

export function DiscoveryFilters({
  query,
  city,
  onApply,
}: {
  query: string;
  city: string;
  onApply: (params: URLSearchParams, city: string) => void;
}) {
  const [draft, setDraft] = useState(() => readFilters(query, city));
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const selectedCity = String(fields.get('city') || '');
    const params = new URLSearchParams({ city: selectedCity });
    for (const field of ['q', 'category', 'sort'] as const) {
      const value = String(fields.get(field) || '').trim();
      if (value) params.set(field, value);
    }
    if (fields.has('available')) params.set('available', 'true');
    onApply(params, selectedCity);
  }
  return (
    <form className="filters panel" onSubmit={apply}>
      <label>
        Search
        <input
          name="q"
          value={draft.q}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          placeholder="Artist, event, or mood"
        />
      </label>
      <div className="form-field">
        <span>City</span>
        <CitySelect
          name="city"
          value={draft.city}
          onChange={(value) => setDraft({ ...draft, city: value })}
        />
      </div>
      <label>
        Category
        <select
          name="category"
          value={draft.category}
          onChange={(event) =>
            setDraft({ ...draft, category: event.target.value })
          }
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </label>
      <label>
        Sort
        <select
          name="sort"
          value={draft.sort}
          onChange={(event) => setDraft({ ...draft, sort: event.target.value })}
        >
          <option value="date">Soonest first</option>
          <option value="newest">Recently added</option>
          <option value="title">Title</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="available"
          value="true"
          checked={draft.available}
          onChange={(event) =>
            setDraft({ ...draft, available: event.target.checked })
          }
        />
        Available tickets
      </label>
      <button className="button" type="submit">
        Find events
      </button>
    </form>
  );
}
