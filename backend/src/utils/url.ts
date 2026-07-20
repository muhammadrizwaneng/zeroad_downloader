/**
 * Normalize pasted or shared URLs before extraction.
 */
export function normalizeMediaUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  const candidate = urlMatch?.[0] ?? trimmed;

  try {
    const parsed = new URL(candidate);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return candidate;
  }
}
