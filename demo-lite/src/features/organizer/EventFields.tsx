import type { Dispatch, SetStateAction, ReactNode } from 'react';
import {
  categories,
  languages,
  agePolicies,
  type EventInput,
} from '@ticketchain/shared';
import { CitySelect } from '../../CitySelect';
type LocalDates = { startsAt: string; endsAt: string; entryAt: string };
type Props = {
  value: EventInput;
  setValue: Dispatch<SetStateAction<EventInput>>;
  local: LocalDates;
  setLocal: Dispatch<SetStateAction<LocalDates>>;
  text: (
    field:
      'title' | 'venue' | 'venueAddress' | 'imageUrl' | 'accessibilityNotes',
    label: string,
  ) => ReactNode;
  zones: string[];
  timezoneSearch: string;
  setTimezoneSearch: Dispatch<SetStateAction<string>>;
};
export function EventFields({
  value,
  setValue,
  local,
  setLocal,
  text,
  zones,
  timezoneSearch,
  setTimezoneSearch,
}: Props) {
  return (
    <>
      <fieldset>
        <legend>Event basics</legend>
        {text('title', 'Event title')}
        <label>
          Category
          <select
            value={value.category}
            onChange={(ev) =>
              setValue({
                ...value,
                category: ev.target.value as EventInput['category'],
              })
            }
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {text('imageUrl', 'HTTPS image URL')}
        <label>
          About the experience
          <textarea
            rows={5}
            maxLength={10000}
            value={value.description}
            onChange={(ev) =>
              setValue({ ...value, description: ev.target.value })
            }
          />
        </label>
        <label>
          Performers (one per line)
          <textarea
            value={value.performers?.join('\n') || ''}
            onChange={(ev) =>
              setValue({
                ...value,
                performers: ev.target.value.split('\n'),
              })
            }
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Venue and timing</legend>
        {text('venue', 'Venue')}
        {text('venueAddress', 'Venue address')}
        <div className="form-field">
          <span>City</span>
          <CitySelect
            value={value.city}
            emptyLabel="Select city"
            onChange={(v) =>
              setValue({ ...value, city: v as EventInput['city'] })
            }
          />
        </div>
        <label>
          Search timezones
          <input
            value={timezoneSearch}
            onChange={(ev) => setTimezoneSearch(ev.target.value)}
          />
        </label>
        <label>
          Event timezone
          <select
            value={value.timezone}
            onChange={(ev) => setValue({ ...value, timezone: ev.target.value })}
          >
            {zones
              .filter(
                (z) =>
                  z === value.timezone ||
                  z
                    .replaceAll('_', ' ')
                    .toLowerCase()
                    .includes(
                      timezoneSearch.replaceAll('_', ' ').toLowerCase(),
                    ) ||
                  (z === 'Asia/Kolkata' &&
                    'india standard time'.includes(
                      timezoneSearch.toLowerCase(),
                    )),
              )
              .map((z) => (
                <option key={z} value={z}>
                  {z === 'Asia/Kolkata'
                    ? 'India Standard Time · Asia/Kolkata'
                    : z.replaceAll('_', ' ')}
                </option>
              ))}
          </select>
        </label>
        {(['startsAt', 'endsAt', 'entryAt'] as const).map((field) => (
          <label key={field}>
            {field === 'startsAt'
              ? 'Start'
              : field === 'endsAt'
                ? 'End'
                : 'Entry time (optional)'}{' '}
            · event timezone
            <input
              type="datetime-local"
              required={field !== 'entryAt'}
              value={local[field]}
              onChange={(ev) =>
                setLocal({ ...local, [field]: ev.target.value })
              }
            />
          </label>
        ))}
        <p>Dates and timezone freeze after the first sale.</p>
      </fieldset>
      <fieldset>
        <legend>Audience information</legend>
        <label>
          Languages
          <select
            multiple
            aria-label="Languages"
            value={value.languages || []}
            onChange={(ev) =>
              setValue({
                ...value,
                languages: Array.from(
                  ev.target.selectedOptions,
                  (o) => o.value,
                ) as EventInput['languages'],
              })
            }
          >
            {languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Age policy
          <select
            value={value.agePolicy || ''}
            onChange={(ev) =>
              setValue({
                ...value,
                agePolicy: (ev.target.value || null) as EventInput['agePolicy'],
              })
            }
          >
            <option value="">Unspecified — choose before publishing</option>
            {agePolicies.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {text('accessibilityNotes', 'Accessibility notes (optional)')}
      </fieldset>
    </>
  );
}
