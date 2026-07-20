export interface MediaFormat {
  formatId: string;
  ext: string;
  quality: string;
  filesize?: number;
  url: string;
  vcodec: string;
  acodec: string;
  type: 'video' | 'audio';
  /** Server will merge separate video + audio streams when downloading. */
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

export interface YtdlpJsonEntry {
  format_id?: string;
  ext?: string;
  format_note?: string;
  height?: number;
  width?: number;
  filesize?: number;
  filesize_approx?: number;
  url?: string;
  vcodec?: string;
  acodec?: string;
  resolution?: string;
  protocol?: string;
  abr?: number;
}

export interface YtdlpJson {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  webpage_url?: string;
  url?: string;
  format_id?: string;
  ext?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
  protocol?: string;
  formats?: YtdlpJsonEntry[];
}
