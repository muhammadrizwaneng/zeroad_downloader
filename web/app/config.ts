// GitHub Release URL — set NEXT_PUBLIC_APK_URL in Vercel (Settings → Environment Variables)
const DEFAULT_APK_URL =
  'https://github.com/muhammadrizwaneng/zeroad_downloader/releases/download/v1.0.0/app-release.apk';

/** GitHub /releases/tag/... links open the release page; /releases/download/... starts the file download. */
function normalizeApkUrl(url: string): string {
  return url.replace(/\/releases\/tag\/([^/]+)\/([^/?#]+)/, '/releases/download/$1/$2');
}

const rawApkUrl = process.env.NEXT_PUBLIC_APK_URL?.trim() || DEFAULT_APK_URL;

export const APK_DOWNLOAD_URL = normalizeApkUrl(rawApkUrl);
export const APK_FILENAME = 'ZeroAds.apk';

export const APP_NAME = 'ZeroAds Downloader';

export const hasApkUrl = APK_DOWNLOAD_URL.length > 0;
