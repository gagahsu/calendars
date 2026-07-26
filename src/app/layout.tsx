import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: '行事曆助理',
  description: '信用卡繳費提醒、待辦事項與 AI 消費分析，可安裝為 App，也能透過 LINE 操作。',
  manifest: '/manifest.webmanifest',
  applicationName: '行事曆助理',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '行事曆助理',
  },
  other: {
    // Next only emits the unprefixed `mobile-web-app-capable`, but iOS Safari
    // still keys standalone-mode installs off the legacy apple- prefixed tag.
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Standalone PWAs need this so the status bar area is coloured, not white.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0f1a' },
    { media: '(prefers-color-scheme: light)', color: '#f5f7fc' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
