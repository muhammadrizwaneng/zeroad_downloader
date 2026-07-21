import RNBlobUtil from 'react-native-blob-util';
import { API_BASE_URL } from '../config';
import type { ExtractError, ExtractResult, MediaFormat } from '../types';

const EXTRACT_TIMEOUT_MS = 360_000;
const POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 15_000;
const WAKE_MAX_WAIT_MS = 90_000;
const WAKE_INTERVAL_MS = 3_000;

type ExtractJobResponse =
  | { jobId: string; status: 'pending' }
  | ExtractResult
  | ExtractError;

type ExtractStatusResponse =
  | { status: 'pending' | 'running' }
  | { status: 'done'; result: ExtractResult }
  | { status: 'error'; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('timed out') || lower.includes('waking up');
}

export async function wakeBackend(): Promise<void> {
  const deadline = Date.now() + WAKE_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        return;
      }
    } catch {
      // Server still waking — retry.
    }
    await sleep(WAKE_INTERVAL_MS);
  }
}

async function pollExtractJob(jobId: string, deadline: number): Promise<ExtractResult> {
  while (Date.now() < deadline) {
    const response = await fetch(`${API_BASE_URL}/api/extract/status/${jobId}`);
    const data = (await response.json()) as ExtractStatusResponse | ExtractError;

    if ('error' in data && !('status' in data)) {
      throw new Error(data.error);
    }

    if ('status' in data) {
      if (data.status === 'done') {
        return data.result;
      }
      if (data.status === 'error') {
        throw new Error(data.error);
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Extraction timed out. Wait a few seconds and tap Extract again.');
}

export async function extractMedia(url: string, attempt = 1): Promise<ExtractResult> {
  const deadline = Date.now() + EXTRACT_TIMEOUT_MS;

  try {
    const response = await fetch(`${API_BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = (await response.json()) as ExtractJobResponse;

    if (!response.ok) {
      const message = 'error' in data ? data.error : 'Failed to extract media from URL.';
      if (attempt < 2 && isTimeoutError(message)) {
        await wakeBackend();
        return extractMedia(url, attempt + 1);
      }
      throw new Error(message);
    }

    if ('jobId' in data && data.status === 'pending') {
      return pollExtractJob(data.jobId, deadline);
    }

    return data as ExtractResult;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (attempt < 2) {
        await wakeBackend();
        return extractMedia(url, attempt + 1);
      }
      throw new Error('Extraction timed out. Wait a few seconds and tap Extract again.');
    }
    throw err;
  }
}

const RESOLVE_TIMEOUT_MS = 120_000;

export async function resolveDownloadUrl(
  pageUrl: string,
  format: { formatId: string; url: string },
): Promise<string> {
  if (format.url.includes('googlevideo.com')) {
    return format.url;
  }
  if (!format.url.includes('/api/download') && !format.url.includes('zeroads-api.onrender.com')) {
    return format.url;
  }

  const params = new URLSearchParams({
    url: pageUrl,
    format: format.formatId,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/resolve?${params.toString()}`, {
      signal: controller.signal,
    });
    const data = (await response.json()) as { url?: string; direct?: boolean; error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Could not resolve download URL.');
    }
    return data.url || format.url;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Server took too long — try again in a moment.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function safeFilename(title: string, quality: string, ext: string): string {
  const cleaned = title.replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'video';
  return `${cleaned}_${quality}.${ext}`;
}

function serverDownloadUrl(pageUrl: string, format: MediaFormat, title: string): string {
  const params = new URLSearchParams({
    url: pageUrl,
    format: format.formatId,
    title: title.slice(0, 120),
  });
  return `${API_BASE_URL}/api/download?${params.toString()}`;
}

/** Save video to Android Downloads via system Download Manager. */
export async function downloadMediaToDevice(
  pageUrl: string,
  format: MediaFormat,
  title: string,
): Promise<void> {
  await wakeBackend();

  // Always download via our server — CDN URLs fail in Download Manager (no Referer/auth).
  const downloadUrl = serverDownloadUrl(pageUrl, format, title);
  const filename = safeFilename(title, format.quality, format.ext);

  await RNBlobUtil.config({
    fileCache: true,
    addAndroidDownloads: {
      useDownloadManager: true,
      notification: true,
      title: filename,
      description: 'ZeroAds download',
      mime: 'video/mp4',
      mediaScannable: true,
    },
  }).fetch('GET', downloadUrl);
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
