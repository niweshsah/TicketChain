import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { authReducer } from './state/auth';
import { ticketApi } from './state/api';
export { session, clear, profile } from './state/auth';
export { ticketApi } from './state/api';
export type { PaymentSetup } from './state/api';
export const store = configureStore({
  reducer: { auth: authReducer, [ticketApi.reducerPath]: ticketApi.reducer },
  middleware: (defaults) => defaults().concat(ticketApi.middleware),
});
setupListeners(store.dispatch);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
