import { CitySelect } from '../CitySelect';
import { EventImage } from '../EventImage';
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
import { ticketApi as api } from '../store';
import { Notice, date } from './feedback';
export function Dashboard() {
  const events = api.useOrganizerEventsQuery();
  const [transition, mutation] = api.useTransitionMutation();
  const [cancelId, setCancelId] = useState<string>();
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR STAGE</span>
          <h1>Organizer dashboard</h1>
        </div>
        <Link className="button" to="/organizer/new">
          Create event +
        </Link>
      </div>
      <Notice error={events.error || mutation.error} />
      {events.isLoading && <p>Loading events…</p>}
      {!events.isLoading && !events.data?.length && (
        <div className="panel">Your first event starts here.</div>
      )}
      {events.data?.map((e) => (
        <article className="panel" key={e.id}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {e.status} · {e.city}
              </span>
              <h2>{e.title}</h2>
              <p>{date(e.starts_at, e.timezone)}</p>
            </div>
            <EventImage className="dashboard-image" src={e.image_url} alt="" />
          </div>
          <div className="actions">
            <Link to={`/organizer/${e.id}/preview`}>Preview</Link>
            {['draft', 'published'].includes(e.status) && (
              <Link to={`/organizer/${e.id}/edit`}>Edit</Link>
            )}
            {e.status === 'draft' && (
              <button
                disabled={mutation.isLoading}
                onClick={() => {
                  void transition({ id: e.id, action: 'publish' })
                    .unwrap()
                    .catch(() => undefined);
                }}
              >
                Publish
              </button>
            )}
            {e.status === 'published' && (
              <Link to={`/organizer/${e.id}/check-in`}>
                Check in & attendees
              </Link>
            )}
            {['draft', 'published'].includes(e.status) && (
              <button onClick={() => setCancelId(e.id)}>Cancel event</button>
            )}
            {e.status === 'published' && new Date(e.ends_at) < new Date() && (
              <button
                disabled={mutation.isLoading}
                onClick={() => {
                  void transition({ id: e.id, action: 'finish' })
                    .unwrap()
                    .catch(() => undefined);
                }}
              >
                Finish event
              </button>
            )}
          </div>
          {cancelId === e.id && (
            <div className="notice">
              <p>
                Cancellation blocks sales and admission immediately and queues
                refunds for unused orders. Partly used orders need manual
                review.
              </p>
              <button
                disabled={mutation.isLoading}
                onClick={() => {
                  void transition({ id: e.id, action: 'cancel' })
                    .unwrap()
                    .then(() => setCancelId(undefined))
                    .catch(() => undefined);
                }}
              >
                Confirm cancellation
              </button>
              <button onClick={() => setCancelId(undefined)}>Keep event</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
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
              onChange={(ev) =>
                setValue({ ...value, timezone: ev.target.value })
              }
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
                  agePolicy: (ev.target.value ||
                    null) as EventInput['agePolicy'],
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.waitingRoom || false}
              onChange={(ev) =>
                setValue({ ...value, waitingRoom: ev.target.checked })
              }
            />
            Enable high-demand waiting room
          </label>
        </fieldset>
        <h2>Ticket tiers</h2>
        <p>
          Removing a saved tier retains its booking history and existing holds.
        </p>
        {value.tiers.map((tier, i) => (
          <fieldset key={tier.id || i}>
            <legend>Tier {i + 1}</legend>
            <label>
              Tier name
              <input
                required
                value={tier.name}
                maxLength={80}
                onChange={(ev) =>
                  setValue({
                    ...value,
                    tiers: value.tiers.map((t, n) =>
                      n === i ? { ...t, name: ev.target.value } : t,
                    ),
                  })
                }
              />
            </label>
            <label>
              Price per ticket (₹)
              <input
                required
                inputMode="decimal"
                value={prices[i]}
                onChange={(ev) =>
                  setPrices(
                    prices.map((p, n) => (n === i ? ev.target.value : p)),
                  )
                }
              />
            </label>
            <label>
              Total inventory
              <input
                type="number"
                required
                min={1}
                max={10000}
                value={tier.quantity}
                onChange={(ev) =>
                  setValue({
                    ...value,
                    tiers: value.tiers.map((t, n) =>
                      n === i ? { ...t, quantity: Number(ev.target.value) } : t,
                    ),
                  })
                }
              />
            </label>
            <label>
              Optional APT price (integer octas)
              <input
                value={tier.priceOctas || ''}
                onChange={(ev) =>
                  setValue({
                    ...value,
                    tiers: value.tiers.map((t, n) =>
                      n === i
                        ? { ...t, priceOctas: ev.target.value || undefined }
                        : t,
                    ),
                  })
                }
              />
            </label>
            <label>
              Inclusions (one per line)
              <textarea
                value={tier.inclusions?.join('\n') || ''}
                onChange={(ev) =>
                  setValue({
                    ...value,
                    tiers: value.tiers.map((t, n) =>
                      n === i
                        ? {
                            ...t,
                            inclusions: ev.target.value.split('\n'),
                          }
                        : t,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              disabled={value.tiers.length === 1}
              onClick={() => {
                setValue({
                  ...value,
                  tiers: value.tiers.filter((_, n) => n !== i),
                });
                setPrices(prices.filter((_, n) => n !== i));
              }}
            >
              Remove tier
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={value.tiers.length >= 10}
          onClick={() => {
            setValue({
              ...value,
              tiers: [
                ...value.tiers,
                { name: '', pricePaise: 149900, quantity: 100 },
              ],
            });
            setPrices([...prices, '1499.00']);
          }}
        >
          Add tier +
        </button>
        {!!e?.retired_tiers?.length && (
          <section>
            <h2>Retired tier history</h2>
            {e.retired_tiers.map((t) => (
              <p key={t.id}>
                {t.name} · {money(t.price_paise)} · retired from sales
              </p>
            ))}
          </section>
        )}
        <Notice error={validation || error || mutation.error} />
        <button className="button" disabled={mutation.isLoading}>
          {mutation.isLoading ? 'Saving…' : 'Save and preview ↗'}
        </button>
      </form>
    </section>
  );
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
export function CheckIn() {
  const { id = '' } = useParams();
  const [code, setCode] = useState('');
  const [check, mutation] = api.useCheckInMutation();
  const attendees = api.useAttendeesQuery(id, { pollingInterval: 3000 });
  const summary = api.useSummaryQuery(id, { pollingInterval: 3000 });
  const [cameraError, setCameraError] = useState<unknown>();
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!camera) return;
    let disposed = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout>;
    void (async () => {
      try {
        const DetectorClass = (
          window as unknown as {
            BarcodeDetector?: new (v: { formats: string[] }) => Detector;
          }
        ).BarcodeDetector;
        if (!DetectorClass)
          throw new Error(
            'QR camera scanning is unavailable in this browser. Use manual entry.',
          );
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        const detector = new DetectorClass({ formats: ['qr_code'] });
        const scan = async () => {
          if (disposed || !video.current) return;
          const results = await detector.detect(video.current);
          if (results.length) {
            setCode(results[0].rawValue);
            setCamera(false);
          } else
            timer = setTimeout(() => {
              void scan();
            }, 500);
        };
        await scan();
      } catch (e) {
        setCameraError(e);
        setCamera(false);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);
  async function handle(ev: FormEvent) {
    ev.preventDefault();
    try {
      await check({ id, code }).unwrap();
      setCode('');
    } catch {
      /* Keep code for correction. */
    }
  }
  return (
    <section className="section narrow">
      <Link to="/organizer">← Dashboard</Link>
      <h1>Welcome them in.</h1>
      <div className="panel">
        <p>
          Admission opens immediately after purchase while the event is active.
          Each ticket works once.
        </p>
        <form onSubmit={(ev) => void handle(ev)}>
          <label>
            Manual ticket code
            <input
              autoComplete="off"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              required
              minLength={16}
            />
          </label>
          <button className="button" disabled={mutation.isLoading || !code}>
            Check in ticket
          </button>
        </form>
        <button
          onClick={() => {
            setCameraError(undefined);
            setCamera(!camera);
          }}
        >
          {camera ? 'Stop camera' : 'Scan with camera'}
        </button>
        {camera && (
          <video ref={video} muted playsInline aria-label="QR scanner" />
        )}
        <Notice error={mutation.error || cameraError} />
        {mutation.data && <Notice>Ticket accepted. Welcome in!</Notice>}
      </div>
      <h2>Event summary</h2>
      <Notice error={summary.error || attendees.error} />
      <div className="panel">
        {summary.data?.map((s) => (
          <p key={`${s.status}-${s.currency}`}>
            {s.status.replaceAll('_', ' ')} · {s.orders} orders ·{' '}
            {money(s.total, s.currency)}
          </p>
        ))}
      </div>
      <h2>Attendees</h2>
      <div className="panel">
        {attendees.data?.map((a) => (
          <div className="tier" key={a.id}>
            <strong>{a.name}</strong>
            <span>
              {a.status} · {a.order_status}
            </span>
          </div>
        ))}
        {!attendees.data?.length && <p>No issued tickets yet.</p>}
      </div>
    </section>
  );
}
