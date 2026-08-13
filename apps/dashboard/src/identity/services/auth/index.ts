import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react'
import LocalStorage from '@/lib/LocalStorage'
import { config } from '@/lib/config'
import type { AppState } from 'stores/app'

const transport = fetchBaseQuery({
  baseUrl: config.apiUrl,
  prepareHeaders: (headers) => {
    const token = LocalStorage.getAuthenticationToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
    headers.set('accept', 'application/json')
    return headers
  },
})

const projectBaseQuery: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const projectRef = (api.getState() as { app?: AppState }).app?.projectRef
  if (!projectRef) {
    return {
      error: {
        status: 409,
        data: {
          error: {
            code: 'identity_project_required',
            message: 'Select a project before using Identity.',
          },
        },
      },
    }
  }
  const original = typeof args === 'string' ? { url: args } : args
  const resource = original.url.startsWith('/')
    ? original.url
    : `/${original.url}`
  return transport(
    {
      ...original,
      url: `${config.apiPath}/identity-admin/projects/${encodeURIComponent(projectRef)}${resource}`,
    },
    api,
    extraOptions,
  )
}

export const authApi = createApi({
  reducerPath: 'identityAuthApi',
  baseQuery: projectBaseQuery,
  endpoints: () => ({}),
})
