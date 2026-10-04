import { client } from '../lib/client';
import * as auth from './auth';
import * as events from './events';
import * as orders from './orders';
import { currentUser } from './data';

async function route(request) {
  const {
    url,
    method = 'GET',
    body,
    headers,
  } = typeof request === 'string' ? { url: request } : request;
  const [path, query = ''] = url.split('?');
  const parts = path.split('/').filter(Boolean);
  if (path === '/auth/providers') return auth.providers();
  if (path === '/auth/logout') {
    const response = await client.auth.signOut();
    if (response.error) throw response.error;
    return null;
  }
  if (parts[0] === 'auth' && parts[1] === 'oauth')
    return auth.oauth(parts[2], body);
  if (parts[0] === 'auth') return auth.authentication(parts[1], body);
  if (path === '/me/avatar')
    return auth.avatar(method === 'DELETE' ? null : body);
  if (path === '/me/organizer') return auth.becomeOrganizer();
  if (path === '/me')
    return method === 'PATCH'
      ? auth.profile(body)
      : auth.publicUser(await currentUser());
  if (path === '/events') return events.discover(query);
  if (parts[0] === 'events') return events.event(parts[1]);
  if (path === '/organizer/events')
    return method === 'POST'
      ? events.save(null, body)
      : events.organizerEvents();
  if (parts[0] === 'organizer') {
    const id = parts[2];
    if (method === 'PUT') return events.save(id, body);
    if (parts[3] === 'preview') return events.event(id, true);
    if (parts[3] === 'attendees') return orders.attendees(id);
    if (parts[3] === 'summary') return orders.summary(id);
    if (parts[3] === 'check-in') return orders.checkIn(id, body.code);
    return events.transition(id, parts[3]);
  }
  if (path === '/orders')
    return method === 'POST'
      ? orders.createOrder(body, headers['Idempotency-Key'])
      : orders.orders();
  if (parts[0] === 'orders')
    return parts[2] === 'refund'
      ? orders.refund(parts[1])
      : orders.order(parts[1]);
  if (path === '/tickets') return orders.tickets();
  if (parts[0] === 'tickets' && parts[2] === 'qr') return orders.qr(parts[1]);
  throw new Error('This service is unavailable');
}

export async function supabaseQuery(request) {
  try {
    return { data: await route(request) };
  } catch (error) {
    return {
      error: {
        status: error.status || 400,
        data: {
          message: error.message || 'Please try again',
          code: error.code,
          ...(error.issues
            ? {
                fields: Object.fromEntries(
                  error.issues.map((issue) => [
                    issue.path.join('.'),
                    [issue.message],
                  ]),
                ),
              }
            : {}),
        },
      },
    };
  }
}
