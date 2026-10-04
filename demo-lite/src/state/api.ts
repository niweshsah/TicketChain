import {
  createApi,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type {
  PublicUser,
  EventDto,
  OrderDto,
  TicketDto,
  EventInput,
  OrderInput,
  PaymentInput,
  OAuthProvider,
  OAuthStart,
} from '@ticketchain/shared';
import { profile, session } from './auth';
import type { RootState } from '../store';
import { supabaseQuery } from '../backend/router';
const baseQuery = supabaseQuery as BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
>;
export interface PaymentSetup {
  operationId: string;
  provider: string;
  status: string;
  providerOrderId: string | null;
  keyId?: string;
  amount: string;
  currency: string;
  treasury?: string;
}
export const ticketApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Events', 'Orders', 'Tickets', 'Me'],
  endpoints: (builder) => ({
    discover: builder.query<{ events: EventDto[] }, string>({
      query: (q) => `/events?${q}`,
      providesTags: ['Events'],
    }),
    waitingRoom: builder.query<
      { state: string; position: number; pass?: string; expiresAt?: number },
      string
    >({ query: (id) => `/events/${id}/waiting-room` }),
    joinWaitingRoom: builder.mutation<
      { state: string; position: number; pass?: string; expiresAt?: number },
      { id: string; operation: 'join' | 'leave' }
    >({
      query: ({ id, operation }) => ({
        url: `/events/${id}/waiting-room`,
        method: 'POST',
        body: { operation },
      }),
    }),
    event: builder.query<EventDto, string>({
      query: (id) => `/events/${id}`,
      providesTags: ['Events'],
    }),
    me: builder.query<PublicUser, void>({
      query: () => '/me',
      providesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if ((getState() as RootState).auth.user?.id === data.id)
            dispatch(profile(data));
          else dispatch(session({ accessToken: 'supabase', user: data }));
        } catch {
          /* Signed-out visitors are expected. */
        }
      },
    }),
    avatar: builder.mutation<PublicUser, File | null>({
      query: (file) => ({
        url: '/me/avatar',
        method: file ? 'POST' : 'DELETE',
        ...(file ? { body: file, headers: { 'Content-Type': file.type } } : {}),
      }),
      invalidatesTags: (result) => (result ? ['Me'] : []),
    }),
    updateProfile: builder.mutation<
      PublicUser,
      { name: string; homeCity?: PublicUser['homeCity'] }
    >({
      query: (body) => ({ url: '/me', method: 'PATCH', body }),
      invalidatesTags: (result) => (result ? ['Me'] : []),
      async onQueryStarted(_arg, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if ((getState() as RootState).auth.user?.id === data.id)
            dispatch(profile(data));
        } catch {
          /* Form shows failure. */
        }
      },
    }),
    becomeOrganizer: builder.mutation<PublicUser, void>({
      query: () => ({ url: '/me/organizer', method: 'POST' }),
      invalidatesTags: ['Me', 'Events'],
      async onQueryStarted(_arg, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if ((getState() as RootState).auth.user?.id === data.id)
            dispatch(profile(data));
        } catch {
          /* Onboarding shows failure. */
        }
      },
    }),
    oauthProviders: builder.query<{ google: boolean; github: boolean }, void>({
      query: () => '/auth/providers',
    }),
    startOAuth: builder.mutation<
      { authorizationUrl: string },
      { provider: OAuthProvider; body: OAuthStart }
    >({
      query: ({ provider, body }) => ({
        url: `/auth/oauth/${provider}/start`,
        method: 'POST',
        body,
      }),
    }),
    auth: builder.mutation<
      { accessToken: string; user: PublicUser },
      { mode: string; body: unknown }
    >({
      query: (v) => ({ url: `/auth/${v.mode}`, method: 'POST', body: v.body }),
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),
    organizerEvents: builder.query<EventDto[], void>({
      query: () => '/organizer/events',
      providesTags: ['Events'],
    }),
    preview: builder.query<EventDto, string>({
      query: (id) => `/organizer/events/${id}/preview`,
      providesTags: ['Events'],
    }),
    save: builder.mutation<EventDto, { id?: string; body: EventInput }>({
      query: (v) => ({
        url: `/organizer/events${v.id ? `/${v.id}` : ''}`,
        method: v.id ? 'PUT' : 'POST',
        body: v.body,
      }),
      invalidatesTags: (result) => (result ? ['Events'] : []),
    }),
    transition: builder.mutation<EventDto, { id: string; action: string }>({
      query: (v) => ({
        url: `/organizer/events/${v.id}/${v.action}`,
        method: 'POST',
      }),
      invalidatesTags: ['Events', 'Orders', 'Tickets'],
    }),
    createOrder: builder.mutation<OrderDto, { body: OrderInput; key: string }>({
      query: (v) => ({
        url: '/orders',
        method: 'POST',
        body: v.body,
        headers: { 'Idempotency-Key': v.key },
      }),
      invalidatesTags: ['Orders', 'Events'],
    }),
    orders: builder.query<OrderDto[], void>({
      query: () => '/orders',
      providesTags: ['Orders'],
    }),
    order: builder.query<OrderDto, string>({
      query: (id) => `/orders/${id}`,
      providesTags: ['Orders'],
    }),
    refund: builder.mutation<OrderDto, string>({
      query: (id) => ({ url: `/orders/${id}/refund`, method: 'POST' }),
      invalidatesTags: ['Orders', 'Tickets', 'Events'],
    }),
    initialize: builder.mutation<PaymentSetup, string>({
      query: (orderId) => ({
        url: '/payments/initialize',
        method: 'POST',
        body: { orderId },
      }),
    }),
    confirm: builder.mutation<{ status: string }, PaymentInput>({
      query: (body) => ({ url: '/payments/confirm', method: 'POST', body }),
      invalidatesTags: ['Orders', 'Tickets', 'Events'],
    }),
    tickets: builder.query<TicketDto[], void>({
      query: () => '/tickets',
      providesTags: ['Tickets'],
    }),
    qr: builder.query<{ code: string }, string>({
      query: (id) => `/tickets/${id}/qr`,
      providesTags: ['Tickets'],
    }),
    checkIn: builder.mutation<{ id: string }, { id: string; code: string }>({
      query: (v) => ({
        url: `/organizer/events/${v.id}/check-in`,
        method: 'POST',
        body: { code: v.code },
      }),
      invalidatesTags: ['Tickets', 'Events'],
    }),
    attendees: builder.query<
      { id: string; name: string; status: string; order_status: string }[],
      string
    >({
      query: (id) => `/organizer/events/${id}/attendees`,
      providesTags: ['Events'],
    }),
    summary: builder.query<
      { status: string; currency: string; orders: number; total: string }[],
      string
    >({
      query: (id) => `/organizer/events/${id}/summary`,
      providesTags: ['Events'],
    }),
    challenge: builder.mutation<
      { id: string; message: string; nonce: string },
      { wallet: string }
    >({
      query: (body) => ({ url: '/me/wallet/challenges', method: 'POST', body }),
    }),
    linkWallet: builder.mutation<{ wallet: string }, unknown>({
      query: (body) => ({ url: '/me/wallet', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    claim: builder.mutation<{ id: string }, string>({
      query: (id) => ({ url: `/tickets/${id}/claim`, method: 'POST' }),
      invalidatesTags: ['Tickets'],
    }),
  }),
});
