import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    tz: Api
  }
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: boolean
        webpreferences?: string
      }
    }
  }
}
export {}
