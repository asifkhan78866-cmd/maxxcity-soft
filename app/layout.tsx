import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MaxxCity Mall — Billing & Management System',
  description:
    'Complete POS billing, inventory management, and business analytics for MaxxCity Mall, Adilabad',
  keywords: ['POS', 'billing', 'inventory', 'MaxxCity Mall', 'Adilabad'],
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MaxxCity POS', statusBarStyle: 'default' },
  icons: { icon: '/icons/maxxcity.svg', apple: '/icons/maxxcity.svg' },
  // The POS is an internal tool; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1B5E20',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Browser extensions write attributes onto <html> before React hydrates
    // (e.g. `crxlauncher=""`), which React reports as a hydration mismatch.
    // suppressHydrationWarning only applies to this element's own attributes,
    // one level deep — genuine mismatches in the page below still surface.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <ServiceWorkerRegistration />
        <Toaster
          position="top-right"
          richColors
          closeButton
          toastOptions={{ classNames: { toast: 'font-sans' } }}
        />
      </body>
    </html>
  );
}
