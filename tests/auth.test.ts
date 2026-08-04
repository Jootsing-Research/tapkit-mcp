import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OAuthClientInformationFullSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  handleAuthenticatedPost,
  POST as mcpPost,
  remoteToolDescriptors,
} from '../api/mcp/index.js';
import { handleAuthorization } from '../api/oauth/authorize.js';
import { handleCallback } from '../api/oauth/callback.js';
import { handleCleanup } from '../api/oauth/cleanup.js';
import { handleConsent } from '../api/oauth/consent.js';
import { handleRegistration } from '../api/oauth/register.js';
import { handleToken } from '../api/oauth/token.js';
import { getOAuthConfig, type OAuthConfig } from '../src/oauth-config.js';
import {
  constantTimeEqual,
  createPkceChallenge,
  decryptSecret,
  encryptSecret,
  escapeHtml,
  hashToken,
} from '../src/oauth-crypto.js';
import {
  authenticateMcpRequest,
  bearerChallenge,
  bearerTokenFromRequest,
  McpAuthError,
  type McpAuthentication,
} from '../src/mcp-auth.js';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../src/oauth-metadata.js';
import { OAuthRepository } from '../src/oauth-repository.js';
import {
  consumeRequestRateLimit,
  rateLimitResponse,
} from '../src/oauth-rate-limit.js';
import {
  ClientMetadataError,
  isSafeRedirectUri,
  validateClientRegistration,
} from '../src/oauth-validation.js';
import { TapKitAPIError, TapKitClient } from '../src/tapkit-client.js';
import { executeTool } from '../src/tools.js';
import {
  createSupabaseAuthorizationUrl,
  exchangeSupabaseAuthorizationCode,
  refreshSupabaseSession,
} from '../src/supabase-auth.js';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');

function config(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    issuer: 'https://mcp.tapkit.ai',
    resource: 'https://mcp.tapkit.ai/mcp',
    protectedResourceMetadataUrl: 'https://mcp.tapkit.ai/.well-known/oauth-protected-resource/mcp',
    supportUrl: 'https://www.tapkit.ai/support',
    privacyUrl: 'https://www.tapkit.ai/privacy',
    termsUrl: 'https://www.tapkit.ai/terms',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    supabaseServiceRoleKey: 'service-role-test-key',
    encryptionKey,
    supabaseProvider: 'google',
    authorizationTtlSeconds: 600,
    authorizationCodeTtlSeconds: 300,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2_592_000,
    ...overrides,
  };
}

function mcpAuthentication(): McpAuthentication {
  return {
    principal: {
      grantId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      clientId: 'test-client',
      resource: 'https://mcp.tapkit.ai/mcp',
      scope: '',
      upstreamAccessToken: 'supabase-upstream-access-token-long-enough',
    },
    authInfo: {
      token: 'mcp_at_test-access-token',
      clientId: 'test-client',
      scopes: [],
      resource: new URL('https://mcp.tapkit.ai/mcp'),
      extra: {
        grantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      },
    },
  };
}

test('authorization and protected-resource metadata satisfy SDK schemas', () => {
  const oauth = authorizationServerMetadata(config());
  const resource = protectedResourceMetadata(config());
  assert.equal(OAuthMetadataSchema.safeParse(oauth).success, true);
  assert.equal(OAuthProtectedResourceMetadataSchema.safeParse(resource).success, true);
  assert.equal(resource.resource, 'https://mcp.tapkit.ai/mcp');
  assert.deepEqual(resource.authorization_servers, ['https://mcp.tapkit.ai']);
  assert.equal('scopes_supported' in oauth, false);
  assert.equal('scopes_supported' in resource, false);
  assert.deepEqual(oauth.code_challenge_methods_supported, ['S256']);
  assert.equal(oauth.service_documentation, 'https://www.tapkit.ai/support');
});

test('OAuth config fails closed for malformed URLs and TTLs', () => {
  const original = { ...process.env };
  try {
    process.env.MCP_SERVER_URL = 'ftp://localhost';
    assert.throws(() => getOAuthConfig(), /HTTPS/);
    process.env.MCP_SERVER_URL = 'https://mcp.tapkit.ai/path';
    assert.throws(() => getOAuthConfig(), /without a path/);
    process.env.MCP_SERVER_URL = 'https://mcp.tapkit.ai';
    process.env.MCP_RESOURCE_URL = 'https://different.example/mcp';
    assert.throws(() => getOAuthConfig(), /\/mcp endpoint/);
    process.env.MCP_RESOURCE_URL = 'https://mcp.tapkit.ai/mcp';
    process.env.OAUTH_CODE_TTL_SECONDS = '10junk';
    assert.throws(() => getOAuthConfig(), /positive integer/);
  } finally {
    process.env = original;
  }
});

test('PKCE, token hashing, encryption, and escaping use safe primitives', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(
    await createPkceChallenge(verifier),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
  assert.equal(await hashToken('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'different'), false);
  const encrypted = await encryptSecret('upstream-secret', encryptionKey);
  assert.notEqual(encrypted.includes('upstream-secret'), true);
  assert.equal(await decryptSecret(encrypted, encryptionKey), 'upstream-secret');
  const tamperedParts = encrypted.split('.');
  tamperedParts[2] = `${tamperedParts[2][0] === 'A' ? 'B' : 'A'}${tamperedParts[2].slice(1)}`;
  const tampered = tamperedParts.join('.');
  await assert.rejects(() => decryptSecret(tampered, encryptionKey));
  assert.equal(escapeHtml(`<a href='x'>&"`), '&lt;a href=&#039;x&#039;&gt;&amp;&quot;');
});

test('dynamic registration rejects unsafe metadata and returns a public client', async () => {
  assert.equal(isSafeRedirectUri('https://chatgpt.com/connector/callback?x=1'), true);
  assert.equal(isSafeRedirectUri('http://127.0.0.1:4812/callback'), true);
  assert.equal(isSafeRedirectUri('http://example.com/callback'), false);
  assert.equal(isSafeRedirectUri('https://example.com/callback#fragment'), false);
  assert.throws(
    () => validateClientRegistration({ redirect_uris: ['https://good.example/cb'], scope: 'phone:read' }, 'id'),
    ClientMetadataError
  );
  assert.throws(
    () => validateClientRegistration({
      redirect_uris: ['https://good.example/cb'],
      grant_types: ['authorization_code'],
    }, 'id'),
    ClientMetadataError
  );

  const store = new OAuthRepository(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([body]), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }, config());
  const response = await handleRegistration(new Request('https://mcp.tapkit.ai/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://chatgpt.com/connector/callback'],
      client_name: '<TapKit test>',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  }), store);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(OAuthClientInformationFullSchema.safeParse(body).success, true);
  assert.match(body.client_id, /^mcp_client_/);
  assert.equal('client_secret' in body, false);
  assert.equal('scope' in body, false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('repository uses service-role auth and resource-bound token RPCs', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const store = new OAuthRepository(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }, config());
  await store.resolveAccessGrant('token-hash', 'https://mcp.tapkit.ai/mcp');
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/mcp_resolve_access_token');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('apikey'), 'service-role-test-key');
  assert.equal(headers.get('Authorization'), 'Bearer service-role-test-key');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    p_token_hash: 'token-hash',
    p_resource: 'https://mcp.tapkit.ai/mcp',
  });
});

test('distributed rate-limit keys are peppered and denials include retry guidance', async () => {
  const inputs: Array<Record<string, unknown>> = [];
  const repository = {
    consumeRateLimit: async (input: Record<string, unknown>) => {
      inputs.push(input);
      return false;
    },
  } as unknown as OAuthRepository;
  const result = await consumeRequestRateLimit(new Request('https://mcp.tapkit.ai/oauth/register', {
    headers: { 'X-Forwarded-For': '203.0.113.42, 10.0.0.1' },
  }), repository, config(), {
    bucket: 'oauth_register',
    limit: 20,
    windowSeconds: 3600,
  }, 'client-id');
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 3600);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].bucket, 'oauth_register');
  assert.equal(String(inputs[0].keyHash).includes('203.0.113.42'), false);
  assert.match(String(inputs[0].keyHash), /^[A-Za-z0-9_-]{43}$/);

  const response = rateLimitResponse(result.retryAfterSeconds);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), String(result.retryAfterSeconds));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('Supabase login uses its PKCE flow without putting sessions in browser URLs', async () => {
  const cfg = config();
  const authorizationUrl = new URL(createSupabaseAuthorizationUrl(
    cfg,
    'challenge-value'
  ));
  assert.equal(authorizationUrl.pathname, '/auth/v1/authorize');
  assert.equal(
    authorizationUrl.searchParams.get('redirect_to'),
    'https://mcp.tapkit.ai/oauth/callback'
  );
  assert.equal(authorizationUrl.searchParams.get('redirect_to')?.includes('?'), false);
  assert.equal(authorizationUrl.searchParams.get('provider'), 'google');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 's256');
  const redirect = new URL(authorizationUrl.searchParams.get('redirect_to')!);
  assert.equal(redirect.toString(), 'https://mcp.tapkit.ai/oauth/callback');
  assert.equal(redirect.search, '');
  assert.equal(authorizationUrl.searchParams.has('access_token'), false);
  assert.equal(authorizationUrl.searchParams.has('refresh_token'), false);

  const requests: Array<{ url: string; body: unknown; authorization: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get('Authorization') || '',
    });
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      access_token: 'supabase-access-token-long-enough',
      // Supabase Auth still supports legacy refresh tokens that are exactly 12 characters.
      refresh_token: 'abc123def456',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const exchanged = await exchangeSupabaseAuthorizationCode('auth-code', 'pkce-verifier', cfg, fakeFetch);
  assert.equal(exchanged.userId, '11111111-1111-4111-8111-111111111111');
  assert.equal(exchanged.refreshToken, 'abc123def456');
  assert.deepEqual(requests[0].body, { auth_code: 'auth-code', code_verifier: 'pkce-verifier' });
  assert.equal(requests[0].authorization, 'Bearer anon-test-key');
  assert.equal(requests[1].authorization, 'Bearer supabase-access-token-long-enough');

  const nestedFetch: typeof fetch = async input => {
    if (String(input).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      data: {
        session: {
          access_token: 'nested-supabase-access-token-long-enough',
          refresh_token: 'nested-supabase-refresh-token-long-enough',
          expires_in: 3600,
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const nested = await exchangeSupabaseAuthorizationCode(
    'nested-auth-code',
    'nested-pkce-verifier',
    cfg,
    nestedFetch
  );
  assert.equal(nested.accessToken, 'nested-supabase-access-token-long-enough');
  assert.equal(nested.refreshToken, 'nested-supabase-refresh-token-long-enough');

  requests.length = 0;
  await refreshSupabaseSession('existing-refresh-token-long-enough', cfg, fakeFetch);
  assert.deepEqual(requests[0].body, { refresh_token: 'existing-refresh-token-long-enough' });
  assert.match(requests[0].url, /grant_type=refresh_token$/);
});

test('browser authorization is cookie-bound, explicitly consented, and redirects with one code', async () => {
  const cfg = config();
  const client = {
    client_id: 'browser-client',
    redirect_uris: ['http://127.0.0.1:50669/callback/test'],
    client_name: 'Browser test client',
    client_uri: null,
    logo_uri: null,
    token_endpoint_auth_method: 'none' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
  const createdAuthorizations: Array<Record<string, unknown>> = [];
  const authorizationStore = {
    getClient: async () => client,
    createAuthorization: async (record: Record<string, unknown>) => {
      createdAuthorizations.push(record);
    },
  } as unknown as OAuthRepository;
  const clientVerifier = 'v'.repeat(43);
  const authorizationResponse = await handleAuthorization(new Request(
    `https://mcp.tapkit.ai/oauth/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      state: 'opaque-client-state',
      response_type: 'code',
      code_challenge: await createPkceChallenge(clientVerifier),
      code_challenge_method: 'S256',
      resource: cfg.resource,
    })}`
  ), authorizationStore, cfg);
  assert.equal(authorizationResponse.status, 302);
  const setCookie = authorizationResponse.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /tapkit_oauth_tx=mcp_tx_[A-Za-z0-9_-]{43}/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  const transaction = /tapkit_oauth_tx=([^;]+)/.exec(setCookie)?.[1] || '';
  assert.equal(createdAuthorizations.length, 1);
  assert.equal(createdAuthorizations[0].transaction_hash, await hashToken(transaction));

  const supabaseAuthorization = new URL(authorizationResponse.headers.get('Location')!);
  assert.equal(
    supabaseAuthorization.searchParams.get('redirect_to'),
    'https://mcp.tapkit.ai/oauth/callback'
  );
  const upstreamVerifierCiphertext = String(
    createdAuthorizations[0].upstream_pkce_verifier_ciphertext
  );
  const upstreamVerifier = await decryptSecret(upstreamVerifierCiphertext, encryptionKey);
  assert.equal(
    await createPkceChallenge(upstreamVerifier),
    supabaseAuthorization.searchParams.get('code_challenge')
  );

  const loginPatches: Array<Record<string, unknown>> = [];
  const callbackStore = {
    getAuthorizationByTransactionHash: async (transactionHash: string) => ({
      ...createdAuthorizations[0],
      transaction_hash: transactionHash,
      status: 'pending_login',
    }),
    completeLogin: async (_transactionHash: string, loginPatch: Record<string, unknown>) => {
      loginPatches.push(loginPatch);
      return {
        ...createdAuthorizations[0],
        ...loginPatch,
        client_id: client.client_id,
        status: 'awaiting_consent',
      };
    },
    getClient: async () => client,
    failAuthorization: async () => undefined,
  } as unknown as OAuthRepository;
  const upstreamFetch: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('/auth/v1/token?grant_type=pkce')) {
      return new Response(JSON.stringify({
        access_token: 'supabase-browser-access-token-long-enough',
        refresh_token: 'supabase-browser-refresh-token-long-enough',
        expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(url, 'https://example.supabase.co/auth/v1/user');
    return new Response(JSON.stringify({ id: '33333333-3333-4333-8333-333333333333' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const callbackResponse = await handleCallback(new Request(
    'https://mcp.tapkit.ai/oauth/callback?code=supabase-code',
    { headers: { Cookie: `tapkit_oauth_tx=${transaction}` } }
  ), callbackStore, cfg, upstreamFetch);
  assert.equal(callbackResponse.status, 200);
  const callbackCsp = callbackResponse.headers.get('Content-Security-Policy') || '';
  assert.match(callbackCsp, /frame-ancestors 'none'/);
  assert.match(callbackCsp, /form-action 'self' http:\/\/127\.0\.0\.1:50669/);
  assert.equal(callbackCsp.includes('/callback/test'), false);
  assert.match(callbackResponse.headers.get('Set-Cookie') || '', /Max-Age=0/);
  assert.equal(loginPatches.length, 1);
  assert.equal(
    String(loginPatches[0].upstream_access_token_ciphertext).includes('supabase-browser-access'),
    false
  );

  const consentHtml = await callbackResponse.text();
  assert.match(consentHtml, /must not be used to make purchases, payments/);
  const consentTransaction = /name="transaction" value="([^"]+)"/.exec(consentHtml)?.[1] || '';
  const consentToken = /name="consent_token" value="([^"]+)"/.exec(consentHtml)?.[1] || '';
  assert.equal(consentTransaction, transaction);
  assert.match(consentToken, /^mcp_consent_[A-Za-z0-9_-]{43}$/);

  const approvals: Array<Record<string, unknown>> = [];
  const consentStore = {
    approveAuthorization: async (input: Record<string, unknown>) => {
      approvals.push(input);
      return {
        redirect_uri: client.redirect_uris[0],
        client_state: 'opaque-client-state',
        resource: cfg.resource,
      };
    },
  } as unknown as OAuthRepository;
  const consentResponse = await handleConsent(new Request('https://mcp.tapkit.ai/oauth/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      transaction: consentTransaction,
      consent_token: consentToken,
      decision: 'approve',
    }),
  }), consentStore, cfg);
  assert.equal(consentResponse.status, 302);
  assert.equal(consentResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal(consentResponse.headers.get('Referrer-Policy'), 'no-referrer');
  const clientRedirect = new URL(consentResponse.headers.get('Location')!);
  assert.equal(clientRedirect.searchParams.get('state'), 'opaque-client-state');
  const authorizationCode = clientRedirect.searchParams.get('code') || '';
  assert.match(authorizationCode, /^mcp_code_[A-Za-z0-9_-]{43}$/);
  assert.equal(approvals[0].transactionHash, await hashToken(transaction));
  assert.equal(approvals[0].consentTokenHash, await hashToken(consentToken));
  assert.equal(approvals[0].codeHash, await hashToken(authorizationCode));
});

test('OAuth callback logs only safe failure classification and a correlation ID', async () => {
  const cfg = config();
  const transaction = `mcp_tx_${'a'.repeat(43)}`;
  const verifier = 'sensitive-upstream-verifier';
  const providerMessage = 'sensitive provider rejection details';
  let failedAuthorizations = 0;
  const repository = {
    getAuthorizationByTransactionHash: async () => ({
      transaction_hash: await hashToken(transaction),
      status: 'pending_login',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      upstream_pkce_verifier_ciphertext: await encryptSecret(verifier, encryptionKey),
    }),
    failAuthorization: async () => { failedAuthorizations += 1; },
  } as unknown as OAuthRepository;
  const upstreamFetch: typeof fetch = async () => new Response(JSON.stringify({
    error_description: providerMessage,
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => { logged.push(values.map(String).join(' ')); };
  let response: Response;
  try {
    response = await handleCallback(new Request(
      'https://mcp.tapkit.ai/oauth/callback?code=sensitive-auth-code',
      { headers: { Cookie: `tapkit_oauth_tx=${transaction}` } }
    ), repository, cfg, upstreamFetch);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 502);
  assert.equal(failedAuthorizations, 1);
  assert.equal(logged.length, 1);
  const event = JSON.parse(logged[0]);
  assert.deepEqual({
    event: event.event,
    step: event.step,
    error_type: event.error_type,
    status: event.status,
    transient: event.transient,
    reason: event.reason,
    operation: event.operation,
  }, {
    event: 'oauth_callback_failed',
    step: 'exchange_upstream_code',
    error_type: 'identity_provider',
    status: 400,
    transient: false,
    reason: 'provider_rejected',
    operation: 'token_exchange',
  });
  assert.match(event.error_id, /^[0-9a-f-]{36}$/i);
  const body = await response.text();
  assert.match(body, new RegExp(event.error_id));
  const combinedOutput = `${logged.join(' ')} ${body}`;
  assert.equal(combinedOutput.includes(providerMessage), false);
  assert.equal(combinedOutput.includes('sensitive-auth-code'), false);
  assert.equal(combinedOutput.includes(verifier), false);
  assert.equal(combinedOutput.includes(transaction), false);
});

test('MCP bearer authentication resolves an opaque token to a separate upstream session', async () => {
  const upstreamToken = 'supabase.jwt.upstream-value';
  const cfg = config();
  const fakeStore = {
    resolveAccessGrant: async (hash: string, resource: string) => {
      assert.equal(hash, await hashToken('mcp_at_inbound-value'));
      assert.equal(resource, cfg.resource);
      return {
        id: 'grant-id',
        user_id: '11111111-1111-4111-8111-111111111111',
        client_id: 'client-id',
        resource: cfg.resource,
        granted_scope: '',
        upstream_access_token_ciphertext: await encryptSecret(upstreamToken, encryptionKey),
        upstream_refresh_token_ciphertext: await encryptSecret('refresh-value', encryptionKey),
        upstream_expires_at: new Date(Date.now() + 60_000).toISOString(),
      };
    },
  } as unknown as OAuthRepository;
  const request = new Request('https://mcp.tapkit.ai/mcp', {
    headers: { Authorization: 'Bearer mcp_at_inbound-value' },
  });
  const authentication = await authenticateMcpRequest(request, fakeStore, cfg);
  assert.equal(authentication.principal.upstreamAccessToken, upstreamToken);
  assert.notEqual(authentication.principal.upstreamAccessToken, bearerTokenFromRequest(request));

  const originalFetch = globalThis.fetch;
  let forwardedAuthorization = '';
  try {
    globalThis.fetch = async (_url, init) => {
      forwardedAuthorization = new Headers(init?.headers).get('Authorization') || '';
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    await new TapKitClient(authentication.principal.upstreamAccessToken).listPhones();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(forwardedAuthorization, `Bearer ${upstreamToken}`);
  assert.equal(forwardedAuthorization.includes('mcp_at_inbound-value'), false);
});

test('authorization-code exchange issues one-time opaque MCP tokens with every binding', async () => {
  const cfg = config();
  const code = 'mcp_code_test-value';
  const verifier = 'a'.repeat(43);
  const challenge = await createPkceChallenge(verifier);
  const exchangeInputs: Array<Record<string, unknown>> = [];
  const fakeStore = {
    getClient: async (clientId: string) => clientId === 'client-id' ? {
      client_id: 'client-id',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: null,
      client_uri: null,
      logo_uri: null,
    } : null,
    getCode: async (codeHash: string) => ({
      code_hash: codeHash,
      grant_id: 'grant-id',
      client_id: 'client-id',
      redirect_uri: 'https://client.example/callback',
      resource: cfg.resource,
      requested_scope: '',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
    getGrant: async () => ({
      id: 'grant-id',
      user_id: '11111111-1111-4111-8111-111111111111',
      client_id: 'client-id',
      resource: cfg.resource,
      granted_scope: '',
      upstream_access_token_ciphertext: 'encrypted-access',
      upstream_refresh_token_ciphertext: 'encrypted-refresh',
      upstream_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    exchangeAuthorizationCode: async (input: Record<string, unknown>) => {
      exchangeInputs.push(input);
      return { id: 'grant-id' };
    },
    revokeGrant: async () => undefined,
  } as unknown as OAuthRepository;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: 'client-id',
    code,
    code_verifier: verifier,
    redirect_uri: 'https://client.example/callback',
    resource: cfg.resource,
  });
  const response = await handleToken(new Request('https://mcp.tapkit.ai/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }), fakeStore, cfg);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(OAuthTokensSchema.safeParse(tokens).success, true);
  assert.match(tokens.access_token, /^mcp_at_/);
  assert.match(tokens.refresh_token, /^mcp_rt_/);
  assert.equal('scope' in tokens, false);
  const exchangeInput = exchangeInputs[0];
  assert.ok(exchangeInput);
  assert.equal(exchangeInput?.clientId, 'client-id');
  assert.equal(exchangeInput?.redirectUri, 'https://client.example/callback');
  assert.equal(exchangeInput?.resource, cfg.resource);
  assert.notEqual(exchangeInput?.accessTokenHash, tokens.access_token);
});

test('refresh rotates both MCP and Supabase sessions without exposing the upstream tokens', async () => {
  const cfg = config();
  const oldMcpRefresh = 'mcp_rt_old-refresh-value';
  const oldUpstreamRefresh = 'supabase-old-refresh-token-long-enough';
  const completedInputs: Array<Record<string, unknown>> = [];
  const claim = {
    id: 'grant-id',
    user_id: '11111111-1111-4111-8111-111111111111',
    client_id: 'client-id',
    resource: cfg.resource,
    granted_scope: '',
    upstream_access_token_ciphertext: await encryptSecret('old-access', encryptionKey),
    upstream_refresh_token_ciphertext: await encryptSecret(oldUpstreamRefresh, encryptionKey),
    upstream_expires_at: new Date(Date.now() + 60_000).toISOString(),
    replayed: false as const,
    busy: false as const,
    refresh_family_id: '22222222-2222-4222-8222-222222222222',
    refresh_generation: 0,
    refresh_claim_id: '33333333-3333-4333-8333-333333333333',
  };
  const fakeStore = {
    getClient: async () => ({ client_id: 'client-id' }),
    claimRefreshToken: async () => claim,
    completeRefresh: async (input: Record<string, unknown>) => {
      completedInputs.push(input);
      return claim;
    },
    releaseRefreshClaim: async () => undefined,
    revokeGrant: async () => undefined,
  } as unknown as OAuthRepository;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: claim.user_id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.match(url, /grant_type=refresh_token$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: oldUpstreamRefresh });
    return new Response(JSON.stringify({
      access_token: 'supabase-new-access-token-long-enough',
      refresh_token: 'supabase-new-refresh-token-long-enough',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const response = await handleToken(new Request('https://mcp.tapkit.ai/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'client-id',
      refresh_token: oldMcpRefresh,
      resource: cfg.resource,
    }),
  }), fakeStore, cfg, fakeFetch);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.match(tokens.access_token, /^mcp_at_/);
  assert.match(tokens.refresh_token, /^mcp_rt_/);
  assert.notEqual(tokens.refresh_token, oldMcpRefresh);
  assert.equal(JSON.stringify(tokens).includes('supabase-new'), false);
  const completed = completedInputs[0];
  assert.ok(completed);
  assert.equal(completed?.refreshFamilyId, claim.refresh_family_id);
  assert.equal(completed?.refreshGeneration, 0);
  assert.equal(completed?.currentRefreshTokenHash, await hashToken(oldMcpRefresh));
});

test('public MCP endpoint rejects missing auth and ignores X-API-Key', async () => {
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  for (const headers of [{}, { 'X-API-Key': 'tk_not_allowed_remotely' }]) {
    const requestHeaders = new Headers({ 'Content-Type': 'application/json' });
    if ('X-API-Key' in headers && headers['X-API-Key']) {
      requestHeaders.set('X-API-Key', headers['X-API-Key']);
    }
    const response = await mcpPost(new Request('https://mcp.tapkit.ai/mcp', {
      method: 'POST',
      headers: requestHeaders,
      body: initialize,
    }));
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('WWW-Authenticate'),
      'Bearer resource_metadata="https://mcp.tapkit.ai/.well-known/oauth-protected-resource/mcp"'
    );
  }
  assert.throws(
    () => bearerTokenFromRequest(new Request('https://mcp.tapkit.ai/mcp', { headers: { Authorization: 'Basic abc' } })),
    (error: unknown) => error instanceof McpAuthError && error.failure === 'invalid'
  );
  assert.match(bearerChallenge('invalid'), /error="invalid_token"/);
});

test('every remote tool is OAuth-only and mirrors security metadata', () => {
  const tools = remoteToolDescriptors();
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    assert.ok(tool.title.length > 0);
    assert.equal(tool.annotations.title, tool.title);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
    assert.equal(typeof tool.annotations.idempotentHint, 'boolean');
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: [] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
});

test('stateless MCP requests survive a fresh server and emit complete tool metadata', async () => {
  const authentication = mcpAuthentication();
  const initialize = await handleAuthenticatedPost(new Request('https://mcp.tapkit.ai/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }),
  }), authentication);
  assert.equal(initialize.status, 200);
  assert.equal(initialize.headers.get('Mcp-Session-Id'), null);
  const initializeBody = await initialize.json();
  assert.equal(initializeBody.result.serverInfo.name, 'tapkit');

  const initialized = await handleAuthenticatedPost(new Request('https://mcp.tapkit.ai/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'Mcp-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }), authentication);
  assert.equal(initialized.status, 202);

  const listed = await handleAuthenticatedPost(new Request('https://mcp.tapkit.ai/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'Mcp-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  }), authentication);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('Mcp-Session-Id'), null);
  const listedBody = await listed.json();
  assert.equal(listedBody.result.tools.length, remoteToolDescriptors().length);
  for (const tool of listedBody.result.tools) {
    assert.ok(tool.title);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: [] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
});

test('tool auth failures request relinking but entitlement errors do not', async () => {
  const authClient = new TapKitClient('upstream');
  authClient.listPhones = async () => {
    throw new TapKitAPIError(401, 'INVALID_TOKEN', 'expired');
  };
  const authResult = await executeTool(authClient, 'list_phones', {});
  assert.equal(authResult.isError, true);
  assert.deepEqual(
    authResult._meta?.['mcp/www_authenticate'],
    [bearerChallenge('invalid')]
  );

  const entitlementClient = new TapKitClient('upstream');
  entitlementClient.listPhones = async () => {
    throw new TapKitAPIError(402, 'SUBSCRIPTION_REQUIRED', 'subscribe');
  };
  const entitlementResult = await executeTool(entitlementClient, 'list_phones', {});
  assert.equal(entitlementResult.isError, true);
  assert.equal(entitlementResult._meta, undefined);
});

test('tool output omits internal Mac IDs and redacts unexpected error details', async () => {
  const client = new TapKitClient('upstream');
  client.listPhones = async () => [{
    id: 'phone-public-id',
    name: 'Demo phone',
    display_name: 'Demo phone',
    connection_status: 'online',
    connected_mac_id: 'internal-mac-id',
    width: 390,
    height: 844,
  }] as Awaited<ReturnType<TapKitClient['listPhones']>>;
  const listed = await executeTool(client, 'list_phones', {});
  assert.equal(listed.content[0].text?.includes('phone-public-id'), true);
  assert.equal(listed.content[0].text?.includes('internal-mac-id'), false);

  client.listPhones = async () => { throw new Error('secret backend debug payload'); };
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => { logged.push(values.map(String).join(' ')); };
  let failed;
  try {
    failed = await executeTool(client, 'list_phones', {});
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failed.content[0].text?.includes('secret backend debug payload'), false);
  assert.equal(logged.join(' ').includes('secret backend debug payload'), false);
  assert.match(failed.content[0].text || '', /error ID [0-9a-f-]{36}/i);
});

test('OAuth cleanup endpoint fails closed and invokes only the service-role cleanup RPC', async () => {
  let cleanupCalls = 0;
  const repository = {
    cleanupExpiredRecords: async () => { cleanupCalls += 1; },
  } as unknown as OAuthRepository;
  const secret = 'cron-secret-at-least-16-characters';

  const denied = await handleCleanup(
    new Request('https://mcp.tapkit.ai/api/oauth/cleanup'),
    repository,
    secret
  );
  assert.equal(denied.status, 401);
  assert.equal(cleanupCalls, 0);

  const cleaned = await handleCleanup(new Request('https://mcp.tapkit.ai/api/oauth/cleanup', {
    headers: { Authorization: `Bearer ${secret}` },
  }), repository, secret);
  assert.equal(cleaned.status, 204);
  assert.equal(cleanupCalls, 1);
});

test('deployment metadata and SQL contain the required security boundaries', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sources = vercel.rewrites.map((rewrite: { source: string }) => rewrite.source);
  assert.ok(sources.includes('/mcp'));
  assert.equal(sources.includes('/mcp/:path*'), false);
  assert.ok(sources.includes('/.well-known/oauth-protected-resource'));
  assert.ok(sources.includes('/.well-known/oauth-protected-resource/mcp'));
  assert.ok(sources.includes('/oauth/consent'));
  assert.ok(sources.includes('/oauth/revoke'));
  assert.deepEqual(vercel.crons, [
    { path: '/api/oauth/cleanup', schedule: '17 3 * * *' },
  ]);

  const migration = await readFile(
    new URL('../supabase/migrations/20260803230000_mcp_oauth.sql', import.meta.url),
    'utf8'
  );
  assert.equal(migration.includes('revoke all on all functions in schema public'), false);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/g);
  assert.match(migration, /from public, anon, authenticated/g);
  assert.match(migration, /claim_id uuid/);
  const claimFunction = migration.split('create function public.mcp_claim_refresh_token')[1]
    .split('create function public.mcp_complete_refresh')[0];
  assert.equal(claimFunction.includes('set consumed_at = now()'), false);
  assert.match(migration, /mcp_resolve_access_token\(\s*p_token_hash text,\s*p_resource text/);
  assert.match(migration, /for orphaned_grant in/);
  assert.match(migration, /not exists \(\s*select 1\s*from public\.mcp_oauth_codes/);
  assert.match(migration, /not exists \(\s*select 1\s*from public\.mcp_oauth_refresh_tokens/);
  assert.match(migration, /refresh_row\.expires_at <= now\(\) and grant_row\.revoked_at is null/);
  assert.match(migration, /create table public\.mcp_oauth_rate_limits/);
  assert.match(migration, /mcp_consume_oauth_rate_limit/);
  assert.match(migration, /clients\.created_at < now\(\) - interval '7 days'/);
  assert.match(migration, /consumed_at > now\(\) - interval '30 seconds'/);

  const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.equal(envExample.includes('OAUTH_SIGNING_SECRET'), false);
  assert.equal(envExample.includes('eyJhbGciOi'), false);
  assert.ok(envExample.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(envExample.includes('OAUTH_ENCRYPTION_KEY'));
  assert.ok(envExample.includes('CRON_SECRET'));
});
