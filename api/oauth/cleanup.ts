import { constantTimeEqual } from '../../src/oauth-crypto.js';
import { OAuthRepository } from '../../src/oauth-repository.js';

export const runtime = 'edge';

export async function handleCleanup(
  request: Request,
  repository?: OAuthRepository,
  cronSecret = process.env.CRON_SECRET || ''
): Promise<Response> {
  const authorization = request.headers.get('Authorization') || '';
  if (cronSecret.length < 16 || !constantTimeEqual(authorization, `Bearer ${cronSecret}`)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    await (repository ?? new OAuthRepository()).cleanupExpiredRecords();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ error: 'CLEANUP_UNAVAILABLE' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleCleanup(request);
}
