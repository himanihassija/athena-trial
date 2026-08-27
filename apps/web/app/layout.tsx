import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

/**
 * Big Shoulders Display for the display type — a condensed, broadcast-poster
 * face with the right amount of presence for the floor state and section
 * headers without competing with the transcript for attention.
 */
const ecoDisplay = Big_Shoulders({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-eco-display',
});

/**
 * IBM Plex Sans for everything else. The transcript is continuous reading
 * text — unlike a game-show HUD, which is mostly short numeric labels — so
 * this project weights legibility over character.
 */
const ecoUi = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-eco-ui',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'Echosphere',
  description:
    'Audio-only live classroom with an AI co-teacher, built on the Agora Conversational AI Engine.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png' }],
    other: [
      {
        url: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full ${ecoDisplay.variable} ${ecoUi.variable}`}>
      <body className="h-full min-h-screen">{children}</body>
    </html>
  );
}
