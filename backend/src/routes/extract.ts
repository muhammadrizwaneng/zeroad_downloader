import { Router, type Request } from 'express';
import { z } from 'zod';
import { extractMedia } from '../services/ytdlp.js';
import { normalizeMediaUrl } from '../utils/url.js';

const extractSchema = z.object({
  url: z.string().min(1, 'A URL is required.'),
});

export const extractRouter = Router();

function resolveApiBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  return `${req.protocol}://${req.get('host')}`;
}

extractRouter.post('/', async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const normalizedUrl = normalizeMediaUrl(parsed.data.url);
  try {
    new URL(normalizedUrl);
  } catch {
    res.status(400).json({ error: 'A valid URL is required.' });
    return;
  }

  try {
    const apiBaseUrl = resolveApiBaseUrl(req);
    const result = await extractMedia(normalizedUrl, apiBaseUrl);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    res.status(422).json({ error: message });
  }
});
