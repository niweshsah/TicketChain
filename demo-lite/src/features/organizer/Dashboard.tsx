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
                Cancellation closes sales and refunds unused bookings.
                Checked-in tickets must be resolved before cancellation.
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
