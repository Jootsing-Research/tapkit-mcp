const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', JSON_CONTENT_TYPE);
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function noStoreJsonResponse(body: unknown, status = 200): Response {
  return jsonResponse(body, status, {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
}

export function oauthErrorResponse(
  error: string,
  description: string,
  status = 400
): Response {
  return noStoreJsonResponse({ error, error_description: description }, status);
}

export function oauthErrorRedirect(
  redirectUri: string,
  state: string,
  error: string,
  description: string
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('Request body is too large');
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new Error('Request body is too large');
  }
  return body;
}

export async function parseJsonBody(request: Request, maxBytes = 32_768): Promise<unknown> {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new Error('Content-Type must be application/json');
  }
  const body = await readBoundedBody(request, maxBytes);
  return JSON.parse(body) as unknown;
}

export async function parseFormBody(
  request: Request,
  maxBytes = 16_384
): Promise<URLSearchParams> {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new Error('Content-Type must be application/x-www-form-urlencoded');
  }
  return new URLSearchParams(await readBoundedBody(request, maxBytes));
}

export function hasExactlyOne(params: URLSearchParams, name: string): boolean {
  return params.getAll(name).length === 1;
}
