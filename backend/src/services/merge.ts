import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Response } from 'express';
import { runYtdlp } from './ytdlp.js';

const MERGE_TIMEOUT_MS = 300_000;

function ensureFfmpeg(): void {
  const found = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!found) {
    throw new Error(
      'ffmpeg is required to merge video and audio. Install it with: brew install ffmpeg',
    );
  }
}

function safeFilename(title: string): string {
  const cleaned = title.replace(/[^\w\s.-]/g, '').trim().slice(0, 80);
  return cleaned || 'video';
}

export async function streamMergedDownload(
  res: Response,
  url: string,
  formatSelector: string,
  title: string,
): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'zeroads-'));
  const outputTemplate = path.join(tmpDir, 'download.%(ext)s');

  try {
    ensureFfmpeg();
    await runYtdlp(
      [
        '-f',
        formatSelector,
        '--merge-output-format',
        'mp4',
        '-o',
        outputTemplate,
        '--no-playlist',
        '--no-warnings',
        url,
      ],
      MERGE_TIMEOUT_MS,
    );

    const files = await readdir(tmpDir);
    const outputFile = files.find((file) => !file.endsWith('.part'));
    if (!outputFile) {
      throw new Error('Merge finished but no output file was created.');
    }

    const filePath = path.join(tmpDir, outputFile);
    const filename = `${safeFilename(title)}.mp4`;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      res.on('error', reject);
      res.on('finish', resolve);
      stream.pipe(res);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
