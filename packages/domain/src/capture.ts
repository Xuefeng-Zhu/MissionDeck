import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { evidenceSchema, type Evidence } from './schemas.js';

export const CAPTURE_CHARACTER_LIMIT = 20000;
export const CAPTURE_INBOX_TTL_MS = 5 * 60 * 1000;

/** Canonical JSON for the exact displayed approval payload, usable in browser and server. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Approval payload contains a non-JSON value');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function hashContent(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function hashPayload(payload: unknown): string {
  return hashContent(stableStringify(payload));
}

/** Sources are citations only; this does not authorize fetching a URL. */
export function sanitizeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|passwd|session|auth|credential|signature|key|^code$|email|phone|jwt|saml|assertion|^sig$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/** True when URL sanitization would do more than benign WHATWG canonicalization. */
export function sourceUrlRequiresSanitization(raw: string): boolean {
  const sanitized = sanitizeSourceUrl(raw);
  if (!sanitized) return true;
  try {
    return sanitized !== new URL(raw).toString();
  } catch {
    return true;
  }
}

/** Syntactic screening only. A server must also resolve DNS and recheck every redirect. */
export function isPublicResearchUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.localdomain') || host.endsWith('.internal') || host === 'localhost' || host.includes(':') || host.startsWith('[')) return false;
    if (/^\d+(\.\d+){3}$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      const c = Number(host.split('.')[2]);
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 100 && b! >= 64 && b! <= 127 || a! >= 224 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function redactSensitiveText(raw: string): string {
  return raw
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED SECRET]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|session[_ -]?token)\s*[:=]\s*["']?[^\s"',;]+["']?/gi, '$1=[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED TOKEN]')
    .replace(/https?:\/\/[^\s<>"']+/g, (url) => sourceUrlRequiresSanitization(url) ? sanitizeSourceUrl(url) ?? '[REMOVED URL]' : url);
}

export interface CaptureInput {
  id: string;
  text: string;
  title: string;
  sourceUrl?: string | null;
  capturedAt: string;
  captureMethod: Evidence['captureMethod'];
  fixture?: boolean;
}

export function prepareCapture(input: CaptureInput, acceptedAt = input.capturedAt): Evidence {
  const redacted = redactSensitiveText(input.text).trim();
  const excerpt = redacted.slice(0, CAPTURE_CHARACTER_LIMIT);
  return evidenceSchema.parse({
    id: input.id,
    sourceUrl: sanitizeSourceUrl(input.sourceUrl),
    title: redactSensitiveText(input.title).trim().slice(0, 500) || 'Untitled capture',
    excerpt,
    capturedAt: input.capturedAt,
    acceptedAt,
    captureMethod: input.captureMethod,
    contentHash: hashContent(normalizeEvidenceText(excerpt)),
    truncated: redacted.length > CAPTURE_CHARACTER_LIMIT,
    retention: 'excerpt',
    fixture: input.fixture ?? false,
  });
}

export function normalizeEvidenceText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function evidenceSimilarity(a: string, b: string): number {
  const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const left = tokens(a), right = tokens(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((word) => right.has(word)).length;
  return common / (left.size + right.size - common);
}

export function findDuplicateEvidence(existing: Evidence[], incoming: Evidence): { exact: Evidence | null; possible: Evidence[] } {
  const incomingHash = hashContent(normalizeEvidenceText(incoming.excerpt));
  return {
    exact: existing.find((item) => hashContent(normalizeEvidenceText(item.excerpt)) === incomingHash) ?? null,
    possible: existing.filter((item) => evidenceSimilarity(item.excerpt, incoming.excerpt) >= 0.65 && hashContent(normalizeEvidenceText(item.excerpt)) !== incomingHash),
  };
}

export function captureExpired(capturedAt: string, now: string): boolean {
  const captured = Date.parse(capturedAt), current = Date.parse(now);
  return !Number.isFinite(captured) || !Number.isFinite(current) || current - captured > CAPTURE_INBOX_TTL_MS || captured > current + 30_000;
}
