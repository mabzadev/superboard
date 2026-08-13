import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { CreatedAppDetail } from 'services/auth/api'

export interface AppState {
  acquireAuthToken: (() => Promise<string>) | null;
  createdApp: CreatedAppDetail | null;
  projectRef: string | null;
}

const initialState: AppState = {
  acquireAuthToken: null,
  createdApp: null,
  projectRef: null,
}

export const appSlice = createSlice({
  name: 'identityAdmin',
  initialState,
  reducers: {
    storeAcquireAuthToken: (
      state,
      action: PayloadAction<AppState['acquireAuthToken']>,
    ) => {
      state.acquireAuthToken = action.payload
    },
    storeCreatedApp: (
      state,
      action: PayloadAction<CreatedAppDetail | null>,
    ) => {
      state.createdApp = action.payload
    },
    selectProject: (state, action: PayloadAction<string | null>) => {
      state.projectRef = action.payload
      state.createdApp = null
    },
  },
})

export default appSlice.reducer
