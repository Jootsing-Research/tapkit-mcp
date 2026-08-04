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
  formRedirectOrigin?: string,
  styleNonce?: string
): Response {
  const formAction = formRedirectOrigin
    ? `'self' ${formRedirectOrigin}`
    : "'self'";
  const stylePolicy = styleNonce
    ? `; style-src 'nonce-${styleNonce}'; img-src 'self'`
    : '';
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'${stylePolicy}; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
      'Set-Cookie': clearTransactionCookie(config),
    },
  });
}

const CONSENT_PAGE_STYLES = `
  :root {
    color-scheme: light;
    --background: #fafafa;
    --surface: #ffffff;
    --text: #111111;
    --muted: #666666;
    --muted-light: #858585;
    --border: #e5e5e5;
    --border-strong: #cfcfcf;
    --accent: #007aff;
    --accent-hover: #0056cc;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
  }

  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    background: var(--background);
    color: var(--text);
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  button,
  a {
    font: inherit;
  }

  .brand {
    position: fixed;
    top: 28px;
    left: 24px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #111827;
    text-decoration: none;
  }

  .brand__icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
  }

  .brand__name {
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }

  .page {
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 104px 24px 56px;
  }

  .consent-card {
    width: min(100%, 572px);
    padding: 48px 40px 38px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 2px 6px rgba(17, 24, 39, 0.04), 0 14px 36px rgba(17, 24, 39, 0.06);
  }

  .consent-card__header {
    text-align: center;
  }

  .app-icon {
    display: block;
    width: 112px;
    height: 112px;
    margin: 0 auto 30px;
    border-radius: 25px;
  }

  h1 {
    margin: 0;
    color: #050505;
    font-size: clamp(30px, 4vw, 36px);
    font-weight: 700;
    line-height: 1.13;
    letter-spacing: -1.25px;
  }

  .subtitle {
    margin: 14px 0 0;
    color: var(--muted);
    font-size: 19px;
    line-height: 1.45;
    letter-spacing: -0.15px;
  }

  .permissions {
    margin-top: 34px;
    border-top: 1px solid var(--border);
  }

  .permissions h2 {
    margin: 30px 0 12px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: -0.2px;
  }

  .permission-row,
  .safety-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: center;
    column-gap: 20px;
    min-height: 74px;
    border-bottom: 1px solid var(--border);
  }

  .permission-row {
    color: #1b1b1b;
    font-size: 17px;
    line-height: 1.45;
  }

  .permission-row img {
    width: 30px;
    height: 30px;
  }

  .safety-row {
    min-height: 102px;
    color: var(--muted-light);
    font-size: 16px;
    line-height: 1.5;
  }

  .safety-row img {
    width: 30px;
    height: 30px;
  }

  .request-origin {
    margin: 26px 0 24px;
    color: var(--muted);
    text-align: center;
    font-size: 16px;
    line-height: 1.4;
  }

  .request-origin strong {
    font-weight: 500;
  }

  .actions {
    display: grid;
    gap: 14px;
  }

  .button {
    width: 100%;
    min-height: 58px;
    padding: 14px 24px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.2;
    transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .button:focus-visible,
  .legal a:focus-visible,
  .brand:focus-visible {
    outline: 3px solid rgba(0, 122, 255, 0.3);
    outline-offset: 3px;
  }

  .button:active {
    transform: translateY(1px);
  }

  .button--primary {
    border: 1px solid #000000;
    background: #000000;
    color: #ffffff;
  }

  .button--primary:hover {
    border-color: #1c1c1c;
    background: #1c1c1c;
  }

  .button--secondary {
    border: 1px solid var(--border-strong);
    background: #ffffff;
    color: #111111;
  }

  .button--secondary:hover {
    border-color: #a9a9a9;
    background: #fafafa;
  }

  .legal {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin: 34px 0 0;
    color: var(--muted);
    font-size: 15px;
  }

  .legal a {
    color: var(--accent);
    text-underline-offset: 3px;
  }

  .legal a:hover {
    color: var(--accent-hover);
  }

  @media (max-width: 620px) {
    .brand {
      position: absolute;
      top: 20px;
      left: 20px;
    }

    .page {
      align-items: flex-start;
      padding: 84px 14px 20px;
    }

    .consent-card {
      padding: 36px 24px 30px;
      border-radius: 14px;
    }

    .app-icon {
      width: 88px;
      height: 88px;
      margin-bottom: 24px;
      border-radius: 20px;
    }

    h1 {
      font-size: 29px;
    }

    .subtitle {
      font-size: 17px;
    }

    .permission-row,
    .safety-row {
      grid-template-columns: 28px minmax(0, 1fr);
      column-gap: 14px;
    }

    .permission-row {
      font-size: 16px;
    }

    .safety-row {
      font-size: 15px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .button {
      transition: none;
    }
  }
`;

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
  const styleNonce = randomToken('', 16);
  const safeClientName = escapeHtml(clientName);
  const safeRedirectHost = escapeHtml(redirect.host);
  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connect ${safeClientName} to TapKit</title>
    <style nonce="${styleNonce}">${CONSENT_PAGE_STYLES}</style>
  </head>
  <body>
    <a class="brand" href="https://www.tapkit.ai" aria-label="TapKit home">
      <img class="brand__icon" src="/tapkit-app-icon.png" alt="" width="28" height="28">
      <span class="brand__name">tapkit</span>
    </a>
    <main class="page">
      <section class="consent-card" aria-labelledby="consent-title">
        <header class="consent-card__header">
          <img class="app-icon" src="/tapkit-app-icon.png" alt="TapKit app icon" width="112" height="112">
          <h1 id="consent-title">Connect ${safeClientName} to TapKit</h1>
          <p class="subtitle">Allow ${safeClientName} to access your connected iPhones</p>
        </header>

        <div class="permissions">
          <h2>${safeClientName} will be able to:</h2>
          <div class="permission-row">
            <img src="/icons/check.svg" alt="" width="30" height="30" aria-hidden="true">
            <span>View connected iPhone screens</span>
          </div>
          <div class="permission-row">
            <img src="/icons/check.svg" alt="" width="30" height="30" aria-hidden="true">
            <span>Control connected iPhones through TapKit</span>
          </div>
          <div class="safety-row">
            <img src="/icons/shield.svg" alt="" width="30" height="30" aria-hidden="true">
            <span>TapKit cannot be used to make purchases, payments, or complete third-party checkout.</span>
          </div>
        </div>

        <p class="request-origin">Requested by <strong>${safeRedirectHost}</strong></p>

        <form class="actions" method="post" action="/oauth/consent">
          <input type="hidden" name="transaction" value="${escapeHtml(transaction)}">
          <input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}">
          <button class="button button--primary" type="submit" name="decision" value="approve">Allow access</button>
          <button class="button button--secondary" type="submit" name="decision" value="deny">Cancel</button>
        </form>

        <nav class="legal" aria-label="TapKit legal and support">
          <a href="${escapeHtml(config.privacyUrl)}">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="${escapeHtml(config.termsUrl)}">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="${escapeHtml(config.supportUrl)}">Support</a>
        </nav>
      </section>
    </main>
  </body>
</html>`, 200, config, redirect.origin, styleNonce);
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
