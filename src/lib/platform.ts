export interface DesktopBridge {
  runtime: 'desktop'
  platform: string
  versions: { electron: string; chrome: string }
}

declare global {
  interface Window {
    dbTracker?: DesktopBridge
  }
}

export const isDesktop = typeof window !== 'undefined' && window.dbTracker?.runtime === 'desktop'
export const runtime: 'desktop' | 'web' = isDesktop ? 'desktop' : 'web'
