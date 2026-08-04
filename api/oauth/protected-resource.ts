import { protectedResourceMetadata } from '../../src/oauth-metadata.js';
import { jsonResponse } from '../../src/oauth-http.js';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  return jsonResponse(protectedResourceMetadata(), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
}
