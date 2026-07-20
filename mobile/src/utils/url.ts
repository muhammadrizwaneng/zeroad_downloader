const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export function extractUrlFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.split(/\s/)[0] ?? null;
  }

  const match = trimmed.match(URL_IN_TEXT_REGEX);
  return match?.[0] ?? null;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (YOUTUBE_HOSTS.has(parsed.hostname) || YOUTUBE_HOSTS.has(host)) {
      return true;
    }
    return parsed.hostname === 'youtu.be';
  } catch {
    return false;
  }
}

export function getPlatformLabel(url: string): string | null {
  if (isYouTubeUrl(url)) {
    return 'YouTube';
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const map: Record<string, string> = {
      'tiktok.com': 'TikTok',
      'instagram.com': 'Instagram',
      'facebook.com': 'Facebook',
      'fb.watch': 'Facebook',
      'twitter.com': 'X',
      'x.com': 'X',
      'snapchat.com': 'Snapchat',
    };
    return map[host] ?? null;
  } catch {
    return null;
  }
}
