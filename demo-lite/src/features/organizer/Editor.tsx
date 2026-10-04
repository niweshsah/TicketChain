import { EventFields } from './EventFields';
import { TierFields } from './TierFields';
import { CitySelect } from '../../CitySelect';
import { EventImage } from '../../EventImage';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  eventSchema,
  money,
  categories,
  languages,
  agePolicies,
  localToUtc,
  utcToLocal,
  rupeesToPaise,
  type EventInput,
} from '@ticketchain/shared';
import { ticketApi as api } from '../../store';
import { Notice, date } from '../feedback';
const blank: EventInput = {
  waitingRoom: false,
  title: '',
  description: '',
  category: 'Concert',
  venue: '',
  city: 'Bengaluru',
  timezone: 'Asia/Kolkata',
  imageUrl: '',
  startsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400000 + 4 * 3600000).toISOString(),
  tiers: [{ name: 'General admission', pricePaise: 149900, quantity: 100 }],
};
export function Editor() {
  const { id } = useParams();
  const {
    data: e,
    error,
    isLoading,
  } = api.usePreviewQuery(id || '', { skip: !id });
  const [value, setValue] = useState<EventInput>(blank);
  const [local, setLocal] = useState({
    startsAt: utcToLocal(blank.startsAt, blank.timezone),
    endsAt: utcToLocal(blank.endsAt, blank.timezone),
    entryAt: '',
  });
  const [prices, setPrices] = useState(['1499.00']);
  const [timezoneSearch, setTimezoneSearch] = useState('');
  const [validation, setValidation] = useState<unknown>();
  const [save, mutation] = api.useSaveMutation();
  const navigate = useNavigate();
  const fieldErrors =
    validation && typeof validation === 'object' && 'issues' in validation
      ? Object.fromEntries(
          (
            validation.issues as {
              path: (string | number)[];
              message: string;
            }[]
          ).map((issue) => [issue.path.join('.'), issue.message]),
        )
      : {};
  useEffect(() => {
    if (validation)
      document
        .querySelector<HTMLInputElement>('.editor [aria-invalid="true"]')
        ?.focus();
  }, [validation]);
  useEffect(() => {
    if (!e) return;
    setValue({
      waitingRoom: e.waiting_room || false,
      title: e.title,
      description: e.description,
      category: e.category as EventInput['category'],
      venue: e.venue,
      city: e.city as EventInput['city'],
      timezone: e.timezone,
      imageUrl: e.image_url,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      performers: e.performers || [],
      venueAddress: e.venue_address || '',
      languages: (e.languages || []) as EventInput['languages'],
      agePolicy: e.age_policy as EventInput['agePolicy'],
      accessibilityNotes: e.accessibility_notes || '',
      tiers: e.tiers.map((t) => ({
        id: t.id,
        name: t.name,
        pricePaise: t.price_paise,
        priceOctas: t.price_octas || undefined,
        quantity: t.quantity,
        inclusions: t.inclusions || [],
      })),
    });
    setPrices(e.tiers.map((t) => (t.price_paise / 100).toFixed(2)));
    setLocal({
      startsAt: utcToLocal(e.starts_at, e.timezone),
      endsAt: utcToLocal(e.ends_at, e.timezone),
      entryAt: e.entry_at ? utcToLocal(e.entry_at, e.timezone) : '',
    });
  }, [e]);
  async function handle(ev: FormEvent) {
    ev.preventDefault();
    try {
      const body = eventSchema.parse({
        ...value,
        performers: value.performers?.map((p) => p.trim()).filter(Boolean),
        startsAt:
          e &&
          e.timezone === value.timezone &&
          local.startsAt === utcToLocal(e.starts_at, e.timezone)
            ? e.starts_at
            : localToUtc(local.startsAt, value.timezone),
        endsAt:
          e &&
          e.timezone === value.timezone &&
          local.endsAt === utcToLocal(e.ends_at, e.timezone)
            ? e.ends_at
            : localToUtc(local.endsAt, value.timezone),
        entryAt: local.entryAt
          ? localToUtc(local.entryAt, value.timezone)
          : null,
        tiers: value.tiers.map((t, i) => ({
          ...t,
          inclusions: t.inclusions?.map((p) => p.trim()).filter(Boolean),
          pricePaise: rupeesToPaise(prices[i]),
        })),
      });
      setValidation(undefined);
      const saved = await save({ id, body }).unwrap();
      navigate(`/organizer/${saved.id}/preview`);
    } catch (err) {
      setValidation(err);
    }
  }
  function text(
    field:
      'title' | 'venue' | 'venueAddress' | 'imageUrl' | 'accessibilityNotes',
    label: string,
  ) {
    return (
      <div className="form-field">
        <label htmlFor={`event-${field}`}>{label}</label>
        <input
          id={`event-${field}`}
          aria-invalid={!!fieldErrors[field]}
          aria-describedby={fieldErrors[field] ? `error-${field}` : undefined}
          value={value[field] || ''}
          maxLength={
            field === 'accessibilityNotes'
              ? 2000
              : field === 'venueAddress'
                ? 500
                : field === 'title'
                  ? 160
                  : undefined
          }
          onChange={(ev) => setValue({ ...value, [field]: ev.target.value })}
        />
        {fieldErrors[field] && (
          <small id={`error-${field}`} className="field-error">
            {fieldErrors[field]}
          </small>
        )}
      </div>
    );
  }
  const zones = Array.from(
    new Set([
      value.timezone,
      'Asia/Kolkata',
      'UTC',
      ...Intl.supportedValuesOf('timeZone'),
    ]),
  );
  if (id && isLoading) return <p role="status">Loading event editor…</p>;
  return (
    <section className="section narrow">
      <Link to="/organizer">← Dashboard</Link>
      <h1>{id ? 'Shape your event.' : 'Set the stage.'}</h1>
      <form className="panel editor" onSubmit={(ev) => void handle(ev)}>
        <EventFields
          value={value}
          setValue={setValue}
          local={local}
          setLocal={setLocal}
          text={text}
          zones={zones}
          timezoneSearch={timezoneSearch}
          setTimezoneSearch={setTimezoneSearch}
        />
        <TierFields
          value={value}
          setValue={setValue}
          prices={prices}
          setPrices={setPrices}
          event={e}
        />
        <Notice error={validation || error || mutation.error} />
        <button className="button" disabled={mutation.isLoading}>
          {mutation.isLoading ? 'Saving…' : 'Save and preview ↗'}
        </button>
      </form>
    </section>
  );
}
