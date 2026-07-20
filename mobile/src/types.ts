export interface MediaFormat {
  formatId: string;
  ext: string;
  quality: string;
  filesize?: number;
  url: string;
  vcodec: string;
  acodec: string;
  type: 'video' | 'audio';
  needsMerge?: boolean;
}

export interface ExtractResult {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  webpageUrl: string;
  formats: MediaFormat[];
}

export interface ExtractError {
  error: string;
  details?: Record<string, string[]>;
}
