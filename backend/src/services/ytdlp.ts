import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMediaUrl } from '../utils/url.js';
import type { ExtractResult, MediaFormat, YtdlpJson, YtdlpJsonEntry } from '../types.js';

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const bundledYtdlp = path.join(backendRoot, 'bin', 'yt-dlp');

const YTDLP_PATH =
  process.env.YTDLP_PATH ??
  (existsSync(bundledYtdlp) ? bundledYtdlp : 'yt-dlp');
const EXTRACT_TIMEOUT_MS = 90_000;

const FAST_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--extractor-retries',
  '2',
  '--socket-timeout',
  '20',
];

const MERGE_HEIGHTS = [1080, 720, 480, 360];

function formatQuality(entry: {
  format_note?: string;
  height?: number;
  width?: number;
  resolution?: string;
}): string {
  if (entry.height) {
    return `${entry.height}p`;
  }
  if (entry.resolution && entry.resolution !== 'audio only') {
    return entry.resolution;
  }
  return entry.format_note ?? 'Best available';
}

function hasVideoAndAudio(entry: { vcodec?: string; acodec?: string }): boolean {
  return Boolean(
    entry.vcodec && entry.vcodec !== 'none' && entry.acodec && entry.acodec !== 'none',
  );
}

function isVideoOnly(entry: { vcodec?: string; acodec?: string }): boolean {
  return Boolean(entry.vcodec && entry.vcodec !== 'none' && (!entry.acodec || entry.acodec === 'none'));
}

function isAudioOnly(entry: { vcodec?: string; acodec?: string }): boolean {
  return Boolean(entry.acodec && entry.acodec !== 'none' && (!entry.vcodec || entry.vcodec === 'none'));
}

function isDirectUrl(entry: { url?: string; protocol?: string }): boolean {
  if (!entry.url) {
    return false;
  }
  const proto = (entry.protocol ?? '').toLowerCase();
  return !proto.includes('m3u8') && !proto.includes('dash');
}

function isStreamUrl(entry: { url?: string; protocol?: string }): boolean {
  if (!entry.url) {
    return false;
  }
  const proto = (entry.protocol ?? '').toLowerCase();
  return proto.includes('m3u8') || proto.includes('dash');
}

function toMediaFormat(entry: YtdlpJsonEntry & { url: string }, overrides?: Partial<MediaFormat>): MediaFormat {
  return {
    formatId: entry.format_id ?? 'unknown',
    ext: entry.ext ?? 'mp4',
    quality: formatQuality(entry),
    filesize: entry.filesize ?? entry.filesize_approx,
    url: entry.url,
    vcodec: entry.vcodec ?? 'none',
    acodec: entry.acodec ?? 'none',
    type: 'video',
    ...overrides,
  };
}

function buildDownloadUrl(apiBaseUrl: string, pageUrl: string, formatId: string, title: string): string {
  const params = new URLSearchParams({
    url: pageUrl,
    format: formatId,
    title: title.slice(0, 120),
  });
  return `${apiBaseUrl}/api/download?${params.toString()}`;
}

function upsertFormat(map: Map<string, MediaFormat>, format: MediaFormat, preferDirect = false): void {
  const key = format.quality.toLowerCase();
  const current = map.get(key);
  if (!current) {
    map.set(key, format);
    return;
  }

  if (preferDirect && current.needsMerge && !format.needsMerge) {
    map.set(key, format);
    return;
  }

  if (!current.needsMerge && format.needsMerge) {
    return;
  }

  if ((format.filesize ?? 0) > (current.filesize ?? 0)) {
    map.set(key, format);
  }
}

function collectDirectCombinedFormats(formats: YtdlpJsonEntry[]): MediaFormat[] {
  const byQuality = new Map<string, MediaFormat>();

  for (const entry of formats) {
    if (!entry.url || !entry.format_id || !hasVideoAndAudio(entry) || !isDirectUrl(entry)) {
      continue;
    }

    upsertFormat(byQuality, toMediaFormat(entry as YtdlpJsonEntry & { url: string }), true);
  }

  return [...byQuality.values()].sort(
    (a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0),
  );
}

function collectStreamCombinedFormats(
  data: YtdlpJson,
  apiBaseUrl: string,
  existing: Map<string, MediaFormat>,
): void {
  const pageUrl = data.webpage_url ?? '';
  const title = data.title ?? 'video';

  for (const entry of data.formats ?? []) {
    if (!entry.url || !entry.format_id || !hasVideoAndAudio(entry) || !isStreamUrl(entry)) {
      continue;
    }

    upsertFormat(
      existing,
      {
        formatId: entry.format_id,
        ext: entry.ext ?? 'mp4',
        quality: formatQuality(entry),
        filesize: entry.filesize ?? entry.filesize_approx,
        url: buildDownloadUrl(apiBaseUrl, pageUrl, entry.format_id, title),
        vcodec: entry.vcodec ?? 'none',
        acodec: entry.acodec ?? 'none',
        type: 'video',
        needsMerge: true,
      },
      false,
    );
  }
}

function pickBestAudio(formats: YtdlpJsonEntry[]): YtdlpJsonEntry | undefined {
  const audioFormats = formats.filter((entry) => entry.format_id && entry.url && isAudioOnly(entry));

  if (audioFormats.length === 0) {
    return undefined;
  }

  return audioFormats.sort((a, b) => {
    const directDiff = Number(isDirectUrl(b)) - Number(isDirectUrl(a));
    if (directDiff !== 0) {
      return directDiff;
    }
    return (b.abr ?? 0) - (a.abr ?? 0);
  })[0];
}

function pickBestVideoAtHeight(formats: YtdlpJsonEntry[], height: number): YtdlpJsonEntry | undefined {
  const videos = formats.filter(
    (entry) => entry.format_id && entry.url && isVideoOnly(entry) && entry.height === height,
  );

  if (videos.length === 0) {
    return undefined;
  }

  return videos.sort((a, b) => {
    const directDiff = Number(isDirectUrl(b)) - Number(isDirectUrl(a));
    if (directDiff !== 0) {
      return directDiff;
    }
    return (b.filesize ?? b.filesize_approx ?? 0) - (a.filesize ?? a.filesize_approx ?? 0);
  })[0];
}

function collectMergedFormats(
  data: YtdlpJson,
  apiBaseUrl: string,
  existing: Map<string, MediaFormat>,
): void {
  const formats = data.formats ?? [];
  const audio = pickBestAudio(formats);
  if (!audio?.format_id) {
    return;
  }

  const pageUrl = data.webpage_url ?? '';
  const title = data.title ?? 'video';

  for (const height of MERGE_HEIGHTS) {
    const quality = `${height}p`;
    const current = existing.get(quality.toLowerCase());
    if (current && !current.needsMerge) {
      continue;
    }

    const video = pickBestVideoAtHeight(formats, height);
    if (!video?.format_id) {
      continue;
    }

    const formatId = `${video.format_id}+${audio.format_id}`;
    const filesize = (video.filesize ?? video.filesize_approx ?? 0) + (audio.filesize ?? audio.filesize_approx ?? 0);

    upsertFormat(existing, {
      formatId,
      ext: 'mp4',
      quality,
      filesize: filesize || undefined,
      url: buildDownloadUrl(apiBaseUrl, pageUrl, formatId, title),
      vcodec: video.vcodec ?? 'none',
      acodec: audio.acodec ?? 'none',
      type: 'video',
      needsMerge: true,
    });
  }
}

function collectFromSelectedMetadata(data: YtdlpJson, apiBaseUrl: string): Map<string, MediaFormat> {
  const formats = new Map<string, MediaFormat>();
  const pageUrl = data.webpage_url ?? '';
  const title = data.title ?? 'video';

  if (data.url && data.format_id && hasVideoAndAudio(data)) {
    if (isDirectUrl(data)) {
      upsertFormat(
        formats,
        {
          formatId: data.format_id,
          ext: data.ext ?? 'mp4',
          quality: formatQuality(data),
          filesize: undefined,
          url: data.url,
          vcodec: data.vcodec ?? 'none',
          acodec: data.acodec ?? 'none',
          type: 'video',
        },
        true,
      );
    } else {
      upsertFormat(formats, {
        formatId: data.format_id,
        ext: data.ext ?? 'mp4',
        quality: formatQuality(data),
        filesize: undefined,
        url: buildDownloadUrl(apiBaseUrl, pageUrl, data.format_id, title),
        vcodec: data.vcodec ?? 'none',
        acodec: data.acodec ?? 'none',
        type: 'video',
        needsMerge: true,
      });
    }
  }

  for (const entry of data.formats ?? []) {
    if (!entry.url || !entry.format_id || !hasVideoAndAudio(entry)) {
      continue;
    }

    if (isDirectUrl(entry)) {
      upsertFormat(formats, toMediaFormat(entry as YtdlpJsonEntry & { url: string }), true);
      continue;
    }

    upsertFormat(formats, {
      formatId: entry.format_id,
      ext: entry.ext ?? 'mp4',
      quality: formatQuality(entry),
      filesize: entry.filesize ?? entry.filesize_approx,
      url: buildDownloadUrl(apiBaseUrl, pageUrl, entry.format_id, title),
      vcodec: entry.vcodec ?? 'none',
      acodec: entry.acodec ?? 'none',
      type: 'video',
      needsMerge: true,
    });
  }

  return formats;
}

function addUniversalFallback(
  data: YtdlpJson,
  apiBaseUrl: string,
  formats: Map<string, MediaFormat>,
): void {
  if (formats.size > 0) {
    return;
  }

  const pageUrl = data.webpage_url ?? '';
  const title = data.title ?? 'video';

  upsertFormat(formats, {
    formatId: 'bestvideo+bestaudio/b',
    ext: 'mp4',
    quality: 'Best available',
    url: buildDownloadUrl(apiBaseUrl, pageUrl, 'bestvideo+bestaudio/b', title),
    vcodec: 'auto',
    acodec: 'auto',
    type: 'video',
    needsMerge: true,
  });
}

function finalizeFormats(formats: Map<string, MediaFormat>): MediaFormat[] {
  return [...formats.values()]
    .sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0))
    .slice(0, 8);
}

function buildFormatMap(data: YtdlpJson, apiBaseUrl: string): Map<string, MediaFormat> {
  const formats = new Map<string, MediaFormat>();

  for (const format of collectDirectCombinedFormats(data.formats ?? [])) {
    upsertFormat(formats, format, true);
  }

  collectMergedFormats(data, apiBaseUrl, formats);
  collectStreamCombinedFormats(data, apiBaseUrl, formats);
  addUniversalFallback(data, apiBaseUrl, formats);

  return formats;
}

export function runYtdlp(args: string[], timeoutMs = EXTRACT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Extraction timed out. Try again or use a different URL.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('yt-dlp is not installed on the server.'));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function runYtdlpJson(args: string[]): Promise<YtdlpJson> {
  const stdout = await runYtdlp(args);
  try {
    return JSON.parse(stdout) as YtdlpJson;
  } catch {
    throw new Error('Failed to parse yt-dlp output.');
  }
}

async function fetchMetadata(url: string): Promise<YtdlpJson> {
  return runYtdlpJson([...FAST_ARGS, '--dump-single-json', url]);
}

async function fetchBestFormat(url: string): Promise<YtdlpJson> {
  return runYtdlpJson([...FAST_ARGS, '-f', 'b', '--dump-single-json', url]);
}

export async function extractMedia(url: string, apiBaseUrl: string): Promise<ExtractResult> {
  const normalizedUrl = normalizeMediaUrl(url);
  let data = await fetchMetadata(normalizedUrl);
  let formats = buildFormatMap(data, apiBaseUrl);

  if (formats.size === 0) {
    data = await fetchBestFormat(normalizedUrl);
    formats = collectFromSelectedMetadata(data, apiBaseUrl);
    addUniversalFallback(data, apiBaseUrl, formats);
  }

  const resultFormats = finalizeFormats(formats);

  if (resultFormats.length === 0) {
    throw new Error(
      'No downloadable formats found. Try another link or platform.',
    );
  }

  return {
    id: data.id ?? '',
    title: data.title ?? 'Untitled',
    thumbnail: data.thumbnail,
    duration: data.duration,
    uploader: data.uploader,
    webpageUrl: data.webpage_url ?? normalizedUrl,
    formats: resultFormats,
  };
}
