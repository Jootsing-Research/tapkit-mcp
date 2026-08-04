import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import {
  decryptSecret,
  encryptSecret,
  escapeHtml,
  hashToken,
  randomToken,
} from '../../src/oauth-crypto.js';
import { oauthErrorRedirect } from '../../src/oauth-http.js';
import { OAuthRepository, OAuthRepositoryError } from '../../src/oauth-repository.js';
import {
  exchangeSupabaseAuthorizationCode,
  SupabaseAuthError,
} from '../../src/supabase-auth.js';

export const runtime = 'edge';

type CallbackFailureStep =
  | 'decrypt_pkce_verifier'
  | 'exchange_upstream_code'
  | 'protect_upstream_session'
  | 'complete_login'
  | 'load_client'
  | 'render_consent';

function logCallbackFailure(
  error: unknown,
  step: CallbackFailureStep,
  errorId: string
): void {
  const details: Record<string, unknown> = {
    event: 'oauth_callback_failed',
    error_id: errorId,
    step,
    error_type: 'unexpected',
  };
  if (error instanceof SupabaseAuthError) {
    details.error_type = 'identity_provider';
    details.status = error.status;
    details.transient = error.transient;
    details.reason = error.reason;
    details.operation = error.operation;
    if (error.responseShape) details.response_shape = error.responseShape;
  } else if (error instanceof OAuthRepositoryError) {
    details.error_type = 'oauth_storage';
    details.status = error.status;
  }
  console.error(JSON.stringify(details));
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function clearTransactionCookie(config: OAuthConfig): string {
  const secure = config.issuer.startsWith('https:') ? '; Secure' : '';
  return `tapkit_oauth_tx=; Path=/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function htmlResponse(
  html: string,
  status: number,
  config: OAuthConfig,
  formRedirectOrigin?: string
): Response {
  const formAction = formRedirectOrigin
    ? `'self' ${formRedirectOrigin}`
    : "'self'";
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
      'Set-Cookie': clearTransactionCookie(config),
    },
  });
}

function errorPage(message: string, status: number, config: OAuthConfig): Response {
  return htmlResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>TapKit authorization</title><body><main><h1>Authorization could not be completed</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(config.supportUrl)}">TapKit support</a></p></main></body></html>`, status, config);
}

function consentPage(
  transaction: string,
  consentToken: string,
  clientName: string,
  redirectUri: string,
  config: OAuthConfig
): Response {
  const redirect = new URL(redirectUri);
  if (!['http:', 'https:'].includes(redirect.protocol)) {
    throw new Error('Unsupported OAuth redirect URI');
  }
  return htmlResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect TapKit</title><body><main><h1>Connect ${escapeHtml(clientName)} to TapKit?</h1><p>Requested by ${escapeHtml(redirect.host)}.</p><p>This allows ${escapeHtml(clientName)} to view your connected iPhone screens and control those iPhones through TapKit.</p><p>This connection must not be used to make purchases, payments, or complete third-party checkout.</p><form method="post" action="/oauth/consent"><input type="hidden" name="transaction" value="${escapeHtml(transaction)}"><input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}"><button type="submit" name="decision" value="approve">Allow</button><button type="submit" name="decision" value="deny">Deny</button></form><p><a href="${escapeHtml(config.privacyUrl)}">Privacy</a> · <a href="${escapeHtml(config.termsUrl)}">Terms</a> · <a href="${escapeHtml(config.supportUrl)}">Support</a></p></main></body></html>`, 200, config, redirect.origin);
}

export async function handleCallback(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig(),
  upstreamFetch: typeof fetch = fetch
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const transaction = cookieValue(request, 'tapkit_oauth_tx');
  if (!transaction || !/^mcp_tx_[A-Za-z0-9_-]{43}$/.test(transaction)) {
    return errorPage('The authorization request is missing or invalid. Please start again.', 400, config);
  }
  const transactionHash = await hashToken(transaction);

  let store: OAuthRepository;
  let authorization;
  try {
    store = repository ?? new OAuthRepository(fetch, config);
    authorization = await store.getAuthorizationByTransactionHash(transactionHash);
  } catch {
    return errorPage('TapKit authorization is temporarily unavailable. Please try again.', 503, config);
  }
  if (!authorization
    || authorization.status !== 'pending_login'
    || Date.parse(authorization.expires_at) <= Date.now()) {
    return errorPage('This authorization request has expired or was already used.', 400, config);
  }

  const providerError = params.get('error') || params.get('error_code');
  if (providerError) {
    await store.failAuthorization(transactionHash).catch(() => undefined);
    const response = oauthErrorRedirect(
      authorization.redirect_uri,
      authorization.client_state,
      'access_denied',
      'Sign-in was cancelled or denied.'
    );
    response.headers.set('Set-Cookie', clearTransactionCookie(config));
    return response;
  }
  const code = params.get('code');
  if (!code || !authorization.upstream_pkce_verifier_ciphertext) {
    await store.failAuthorization(transactionHash).catch(() => undefined);
    return errorPage('The identity provider did not return a valid authorization code.', 400, config);
  }

  let failureStep: CallbackFailureStep = 'decrypt_pkce_verifier';
  try {
    const verifier = await decryptSecret(
      authorization.upstream_pkce_verifier_ciphertext,
      config.encryptionKey
    );
    failureStep = 'exchange_upstream_code';
    const session = await exchangeSupabaseAuthorizationCode(code, verifier, config, upstreamFetch);
    failureStep = 'protect_upstream_session';
    const consentToken = randomToken('mcp_consent_');
    const protectedSession = {
      user_id: session.userId,
      upstream_access_token_ciphertext: await encryptSecret(session.accessToken, config.encryptionKey),
      upstream_refresh_token_ciphertext: await encryptSecret(session.refreshToken, config.encryptionKey),
      upstream_expires_at: session.expiresAt,
      consent_token_hash: await hashToken(consentToken),
    };
    failureStep = 'complete_login';
    const completed = await store.completeLogin(transactionHash, {
      ...protectedSession,
    });
    if (!completed) {
      return errorPage('This authorization request expired before sign-in completed.', 400, config);
    }
    failureStep = 'load_client';
    const client = await store.getClient(completed.client_id);
    if (!client) {
      await store.failAuthorization(transactionHash).catch(() => undefined);
      return errorPage('The requesting application is no longer registered.', 400, config);
    }
    failureStep = 'render_consent';
    return consentPage(
      transaction,
      consentToken,
      client.client_name || 'the requesting application',
      completed.redirect_uri,
      config
    );
  } catch (error) {
    const errorId = crypto.randomUUID();
    logCallbackFailure(error, failureStep, errorId);
    await store.failAuthorization(transactionHash).catch(() => undefined);
    return errorPage(
      `TapKit could not complete sign-in. Please start the connection again. Reference: ${errorId}`,
      502,
      config
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleCallback(request);
}
