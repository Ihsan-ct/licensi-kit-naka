import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NAKA Mission Control — Global License Operations Center',
  description: 'Secure, real-time license management and Roblox installation monitoring for NAKA products',
  applicationName: 'NAKA License Cloud',
  keywords: ['NAKA', 'license management', 'Roblox', 'license cloud', 'security'],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
