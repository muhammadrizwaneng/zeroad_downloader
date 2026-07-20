// GitHub Release URL — set NEXT_PUBLIC_APK_URL in Vercel (Settings → Environment Variables)
export const APK_DOWNLOAD_URL = process.env.NEXT_PUBLIC_APK_URL ?? '';

export const APP_NAME = 'ZeroAds Downloader';

export const hasApkUrl = APK_DOWNLOAD_URL.length > 0;
