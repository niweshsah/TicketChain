import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PublicUser } from '@ticketchain/shared';
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    accessToken: null as string | null,
    user: null as PublicUser | null,
    revision: 0,
  },
  reducers: {
    session: (
      state,
      action: PayloadAction<{ accessToken: string; user: PublicUser }>,
    ) => {
      state.revision += 1;
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
    },
    profile: (state, action: PayloadAction<PublicUser>) => {
      state.user = action.payload;
    },
    clear: (state) => {
      state.revision += 1;
      state.accessToken = null;
      state.user = null;
    },
  },
});
export const { session, clear, profile } = authSlice.actions;
export const authReducer = authSlice.reducer;
