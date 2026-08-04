import type { OAuthConfig } from './oauth-config.js';
import { hashToken } from './oauth-crypto.js';
import type { OAuthRepository } from './oauth-repository.js';

export interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function requestAddress(request: Request): string {
  const forwarded = request.headers.get('x-vercel-forwarded-for')
    || request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';
  return forwarded.split(',')[0].trim().slice(0, 128) || 'unknown';
}

export async function consumeRequestRateLimit(
  request: Request,
  repository: OAuthRepository,
  config: OAuthConfig,
  policy: RateLimitPolicy,
  subject = ''
): Promise<RateLimitResult> {
  const windowMs = policy.windowSeconds * 1000;
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const keyHash = await hashToken([
    config.encryptionKey,
    policy.bucket,
    requestAddress(request),
    subject,
  ].join('\u0000'));
  const allowed = await repository.consumeRateLimit({
    bucket: policy.bucket,
    keyHash,
    windowStart: new Date(windowStartMs).toISOString(),
    limit: policy.limit,
  });
  return {
    allowed,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000)),
  };
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({
    error: 'temporarily_unavailable',
    error_description: 'Too many requests. Wait briefly and try again.',
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfterSeconds),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
