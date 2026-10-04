import { Link } from 'react-router-dom';
import { money, type EventDto } from '@ticketchain/shared';
import { EventImage } from '../../EventImage';
import { date } from '../feedback';
export function Cards({ events }: { events: EventDto[] }) {
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
