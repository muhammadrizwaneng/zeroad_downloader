import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZeroAds Downloader — Download APK',
  description: 'Ad-free YouTube and social media downloader for Android.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
