import { API_BASE_URL } from '../config';
import type { ExtractError, ExtractResult } from '../types';

const EXTRACT_TIMEOUT_MS = 300_000;

export async function extractMedia(url: string): Promise<ExtractResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    const data = (await response.json()) as ExtractResult | ExtractError;

    if (!response.ok) {
      const message =
        'error' in data ? data.error : 'Failed to extract media from URL.';
      throw new Error(message);
    }

    return data as ExtractResult;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Extraction timed out. The server may still be waking up — wait a few seconds and tap Extract again.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
