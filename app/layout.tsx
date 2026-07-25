import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NAKA License Cloud',
  description: 'Enterprise Roblox license command center'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
