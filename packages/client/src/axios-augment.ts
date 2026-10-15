import type {} from 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    mock?: boolean
    meta?: Record<string, unknown>
  }
}
