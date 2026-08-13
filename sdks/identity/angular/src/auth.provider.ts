import {
  InjectionToken,
} from '@angular/core'
import type { Provider } from '@angular/core'
import type { ProviderConfig } from '@melody-auth/shared'

export const PROVIDER_CONFIG = new InjectionToken<ProviderConfig>('melody-auth.config')

export function provideAuth (config: ProviderConfig): Provider[] {
  return [
    {
      provide: PROVIDER_CONFIG, useValue: config,
    },
  ]
}
