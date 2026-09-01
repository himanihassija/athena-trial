import type { Metadata, Viewport } from 'next';
import { Oswald, IBM_Plex_Sans, IBM_Plex_Sans_Devanagari, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Condensed grotesque for the wordmark and titles — the "broadcast desk" voice.
const displayFont = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
});

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

const devanagariFont = IBM_Plex_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-devanagari',
});

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'Athena — AI Co-Teacher',
  description:
    'Live classroom with a restraint-focused AI co-teacher, built on Agora ConvoAI and Sarvam.',
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

/**
 * Sets `data-eco-theme` on <html> before React hydrates. Light is the
 * default ground (see globals.css); this only ever needs to write "dark"
 * when the person previously chose it via ThemeToggle. Runs synchronously
 * as a blocking inline script so there is no flash of the wrong theme.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('echosphere.theme');
    if (stored === 'dark') {
      document.documentElement.dataset.ecoTheme = 'dark';
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full ${displayFont.variable} ${bodyFont.variable} ${devanagariFont.variable} ${monoFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full min-h-screen">{children}</body>
    </html>
  );
}
