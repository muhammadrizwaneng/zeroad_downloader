import { Router } from 'express';
import { z } from 'zod';
import { streamMergedDownload } from '../services/merge.js';

const downloadSchema = z.object({
  url: z.string().url(),
  format: z.string().min(1).max(200),
  title: z.string().max(120).optional(),
});

export const downloadRouter = Router();

downloadRouter.get('/', async (req, res) => {
  const parsed = downloadSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    await streamMergedDownload(
      res,
      parsed.data.url,
      parsed.data.format,
      parsed.data.title ?? 'video',
    );
  } catch (err) {
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Download failed';
      res.status(422).json({ error: message });
    }
  }
});
