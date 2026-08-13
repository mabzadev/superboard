'use client'

import { useEffect, type PropsWithChildren } from 'react'
import { Provider, useDispatch } from 'react-redux'
import { AlertCircle, Fingerprint, LoaderCircle } from 'lucide-react'
import { useProjectSelection } from '@/context/useProjectSelection'
import LocalStorage from '@/lib/LocalStorage'
import { config } from '@/lib/config'
import { Alert, AlertDescription, AlertTitle } from 'identity/components/ui/alert'
import { configSignal, errorSignal } from 'signals'
import { appSlice } from 'stores/app'
import { authApi } from 'services/auth'
import { store, type AppDispatch } from 'stores'
import useSignalValue from './useSignalValue'

export default function Setup ({ children }: PropsWithChildren) {
  return <Provider store={store}><ProjectIdentity>{children}</ProjectIdentity></Provider>
}

function ProjectIdentity ({ children }: PropsWithChildren) {
  const dispatch = useDispatch<AppDispatch>()
  const { selectedProject, selectedInstance } = useProjectSelection()
  const error = useSignalValue(errorSignal)
  const projectRef = selectedProject?.id ?? null
  const canAdminister = !selectedInstance?.role ||
    selectedInstance.role === 'owner' ||
    selectedInstance.role === 'admin'

  useEffect(() => {
    dispatch(authApi.util.resetApiState())
    dispatch(appSlice.actions.selectProject(projectRef))
    dispatch(appSlice.actions.storeAcquireAuthToken(async () =>
      LocalStorage.getAuthenticationToken() ?? ''))
    errorSignal.value = ''
    if (!projectRef || !canAdminister) return

    const controller = new AbortController()
    const loadConfiguration = async () => {
      const base = `${config.apiUrl}${config.apiPath}/identity-admin/projects/${encodeURIComponent(projectRef)}`
      const headers = {
        accept: 'application/json',
        authorization: `Bearer ${LocalStorage.getAuthenticationToken() ?? ''}`,
      }
      const response = await fetch(
        base,
        {
          headers,
          signal: controller.signal,
        },
      )
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json() as { configs?: Record<string, unknown> }
      if (payload.configs) {
        configSignal.value = {
          ...configSignal.value,
          ...payload.configs,
        }
      }
      const appsResponse = await fetch(`${base}/api/v1/apps`, {
        headers,
        signal: controller.signal,
      })
      if (appsResponse.ok) {
        const appsPayload = await appsResponse.json() as {
          apps?: Array<{
            clientId: string;
            isActive: boolean;
            redirectUris: string[];
            type: string;
          }>;
        }
        const primary = appsPayload.apps?.find((app) =>
          app.type === 'spa' && app.isActive && app.redirectUris.length > 0)
        if (primary) {
          window.sessionStorage.setItem(
            'superboard.identity.primaryApp',
            JSON.stringify({
              clientId: primary.clientId,
              redirectUri: primary.redirectUris[0],
            }),
          )
        } else {
          window.sessionStorage.removeItem('superboard.identity.primaryApp')
        }
      }
    }
    void loadConfiguration().catch((cause) => {
      if (!controller.signal.aborted) {
        errorSignal.value = cause instanceof Error
          ? cause.message
          : 'Identity configuration could not be loaded.'
      }
    })
    return () => controller.abort()
  }, [canAdminister, dispatch, projectRef])

  if (!projectRef) {
    return (
      <div className='flex min-h-80 items-center justify-center gap-3 text-muted-foreground'>
        <LoaderCircle className='size-5 animate-spin' />
        Loading the selected project…
      </div>
    )
  }
  if (!canAdminister) {
    return (
      <div className='mx-auto max-w-2xl p-6 md:p-10'>
        <Alert variant='destructive'>
          <AlertCircle className='size-4' />
          <AlertTitle>Administrator access required</AlertTitle>
          <AlertDescription>
            Identity settings can be changed only by a project owner or administrator.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <section className='identity-admin mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 md:p-7'>
      <div className='flex items-center gap-3 border-b border-border pb-4'>
        <span className='flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
          <Fingerprint className='size-5' />
        </span>
        <div>
          <h1 className='text-lg font-semibold tracking-tight'>Identity</h1>
          <p className='text-sm text-muted-foreground'>
            Authentication, users, organizations, access and SSO for this project.
          </p>
        </div>
      </div>
      {error && (
        <Alert variant='destructive'>
          <AlertCircle className='size-4' />
          <AlertTitle>Identity request failed</AlertTitle>
          <AlertDescription className='break-words'>{error}</AlertDescription>
        </Alert>
      )}
      {children}
    </section>
  )
}
