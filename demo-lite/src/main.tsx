import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store';
import { App } from './App';
import './styles.css';
import { client, configured } from './lib/client';
import { session, clear, ticketApi } from './store';
import type { PublicUser } from '@ticketchain/shared';
import { publicUser } from './backend/auth';
let previousUser: string | undefined;
if (client)
  client.auth.onAuthStateChange((_event: string, next: any) => {
    const id = next?.user?.id;
    if (id && previousUser && id !== previousUser)
      store.dispatch(ticketApi.util.resetApiState());
    previousUser = id;
    if (next)
      store.dispatch(
        session({
          accessToken: next.access_token,
          user: publicUser(next.user) as PublicUser,
        }),
      );
    else store.dispatch(clear());
  });
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter useTransitions={false}>
        {configured ? (
          <App />
        ) : (
          <main className="section narrow panel">
            <h1>TicketChain</h1>
            <p>
              The service is temporarily unavailable. Please try again later.
            </p>
          </main>
        )}
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
);
