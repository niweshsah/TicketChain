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
