'use client';

import { useEffect, useState } from 'react';
import { APP_NAME, APK_DOWNLOAD_URL, hasApkUrl } from './config';

type DeviceType = 'android' | 'ios' | 'other' | 'loading';

function detectDevice(): DeviceType {
  if (typeof navigator === 'undefined') {
    return 'loading';
  }

  const ua = navigator.userAgent || navigator.vendor || '';

  if (/android/i.test(ua)) {
    return 'android';
  }

  if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }

  return 'other';
}

function DownloadButton({ label }: { label: string }) {
  if (!hasApkUrl) {
    return (
      <p className="note" style={{ marginTop: 20 }}>
        APK link not configured yet. Upload the APK to GitHub Releases and set{' '}
        <code>NEXT_PUBLIC_APK_URL</code> in Vercel.
      </p>
    );
  }

  return (
    <p style={{ marginTop: 20 }}>
      <a
        className="download-btn"
        href={APK_DOWNLOAD_URL}
        rel="noopener noreferrer">
        {label}
      </a>
    </p>
  );
}

export default function HomePage() {
  const [device, setDevice] = useState<DeviceType>('loading');

  useEffect(() => {
    setDevice(detectDevice());
  }, []);

  return (
    <main className="page">
      <h1 className="logo">ZeroAds</h1>
      <p className="tagline">Ad-free YouTube &amp; social media downloader for Android</p>

      {device === 'loading' && (
        <div className="card">
          <p className="loading">Loading…</p>
        </div>
      )}

      {device === 'android' && (
        <div className="card">
          <h2>Download the app</h2>
          <p>
            Tap the button below to download <strong>{APP_NAME}</strong> on your Android phone.
          </p>
          <ul className="features">
            <li>No ads</li>
            <li>YouTube, TikTok, Instagram &amp; more</li>
            <li>Share a link → download instantly</li>
          </ul>
          <DownloadButton label="Download APK" />
          <p className="note" style={{ marginTop: 16 }}>
            If install is blocked, allow &quot;Install from unknown sources&quot; in Settings.
          </p>
        </div>
      )}

      {device === 'ios' && (
        <div className="card">
          <div className="ios-icon" aria-hidden="true">
            🍎
          </div>
          <h2 className="warning">This is only for Android users</h2>
          <p>
            ZeroAds Downloader is available as an APK for Android devices only. iPhone and iPad are
            not supported at this time.
          </p>
        </div>
      )}

      {device === 'other' && (
        <div className="card">
          <h2>Android app only</h2>
          <p>
            Open this page on your <strong>Android phone</strong> to download the APK.
          </p>
          <DownloadButton label="Download APK" />
          <p className="note" style={{ marginTop: 16 }}>
            iOS users: This app is not available on iPhone or iPad.
          </p>
        </div>
      )}

      <p className="note">Free · No ads · No account required</p>
    </main>
  );
}
