create extension if not exists pgcrypto;

create table public.mcp_oauth_clients (
  client_id text primary key,
  redirect_uris jsonb not null
    check (jsonb_typeof(redirect_uris) = 'array' and jsonb_array_length(redirect_uris) between 1 and 10),
  client_name text,
  client_uri text,
  logo_uri text,
  token_endpoint_auth_method text not null default 'none'
    check (token_endpoint_auth_method = 'none'),
  grant_types jsonb not null default '["authorization_code", "refresh_token"]'::jsonb
    check (jsonb_typeof(grant_types) = 'array'),
  response_types jsonb not null default '["code"]'::jsonb
    check (jsonb_typeof(response_types) = 'array'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.mcp_oauth_authorizations (
  transaction_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id),
  redirect_uri text not null,
  client_state text not null,
  resource text not null,
  requested_scope text not null default '',
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  upstream_pkce_verifier_ciphertext text,
  user_id uuid references auth.users(id) on delete cascade,
  upstream_access_token_ciphertext text,
  upstream_refresh_token_ciphertext text,
  upstream_expires_at timestamptz,
  consent_token_hash text unique,
  status text not null
    check (status in ('pending_login', 'awaiting_consent', 'approved', 'denied', 'failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'pending_login' or upstream_pkce_verifier_ciphertext is not null)
);

create table public.mcp_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients(client_id),
  resource text not null,
  granted_scope text not null default '',
  upstream_access_token_ciphertext text,
  upstream_refresh_token_ciphertext text,
  upstream_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    revoked_at is not null
    or (
      upstream_access_token_ciphertext is not null
      and upstream_refresh_token_ciphertext is not null
      and upstream_expires_at is not null
    )
  )
);
create index mcp_oauth_grants_user_id_idx on public.mcp_oauth_grants(user_id);

create table public.mcp_oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients(client_id),
  redirect_uri text not null,
  resource text not null,
  requested_scope text not null default '',
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.mcp_oauth_access_tokens (
  token_hash text primary key,
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index mcp_oauth_access_tokens_grant_idx on public.mcp_oauth_access_tokens(grant_id);

create table public.mcp_oauth_refresh_tokens (
  token_hash text primary key,
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  family_id uuid not null,
  generation integer not null check (generation >= 0),
  expires_at timestamptz not null,
  claim_id uuid,
  claimed_at timestamptz,
  consumed_at timestamptz,
  replaced_by_hash text references public.mcp_oauth_refresh_tokens(token_hash),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, generation),
  check ((claim_id is null) = (claimed_at is null))
);
create index mcp_oauth_refresh_tokens_grant_idx on public.mcp_oauth_refresh_tokens(grant_id);
create index mcp_oauth_refresh_tokens_family_idx on public.mcp_oauth_refresh_tokens(family_id);

create table public.mcp_oauth_rate_limits (
  bucket text not null check (length(bucket) between 1 and 64),
  key_hash text not null check (length(key_hash) between 32 and 128),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (bucket, key_hash, window_start)
);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_authorizations enable row level security;
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_access_tokens enable row level security;
alter table public.mcp_oauth_refresh_tokens enable row level security;
alter table public.mcp_oauth_rate_limits enable row level security;

revoke all on table public.mcp_oauth_clients, public.mcp_oauth_authorizations,
  public.mcp_oauth_grants, public.mcp_oauth_codes, public.mcp_oauth_access_tokens,
  public.mcp_oauth_refresh_tokens, public.mcp_oauth_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on table public.mcp_oauth_clients,
  public.mcp_oauth_authorizations, public.mcp_oauth_grants, public.mcp_oauth_codes,
  public.mcp_oauth_access_tokens, public.mcp_oauth_refresh_tokens to service_role;

create function public.mcp_consume_oauth_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_window_start timestamptz,
  p_limit integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  current_count integer;
begin
  if length(p_bucket) not between 1 and 64
    or length(p_key_hash) not between 32 and 128
    or p_limit not between 1 and 10000
  then
    return false;
  end if;

  insert into public.mcp_oauth_rate_limits(
    bucket, key_hash, window_start, request_count
  ) values (
    p_bucket, p_key_hash, p_window_start, 1
  )
  on conflict (bucket, key_hash, window_start)
  do update set request_count = public.mcp_oauth_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

create function public.mcp_complete_authorization_login(
  p_transaction_hash text,
  p_user_id uuid,
  p_upstream_access_token_ciphertext text,
  p_upstream_refresh_token_ciphertext text,
  p_upstream_expires_at timestamptz,
  p_consent_token_hash text
) returns setof public.mcp_oauth_authorizations
language plpgsql security definer set search_path = '' as $$
begin
  return query
    update public.mcp_oauth_authorizations
    set user_id = p_user_id,
      upstream_access_token_ciphertext = p_upstream_access_token_ciphertext,
      upstream_refresh_token_ciphertext = p_upstream_refresh_token_ciphertext,
      upstream_expires_at = p_upstream_expires_at,
      consent_token_hash = p_consent_token_hash,
      upstream_pkce_verifier_ciphertext = null,
      status = 'awaiting_consent',
      updated_at = now()
    where transaction_hash = p_transaction_hash
      and status = 'pending_login'
      and expires_at > now()
    returning *;
end;
$$;

create function public.mcp_approve_authorization(
  p_transaction_hash text,
  p_consent_token_hash text,
  p_grant_id uuid,
  p_code_hash text,
  p_code_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  auth_row public.mcp_oauth_authorizations%rowtype;
begin
  select authorizations.* into auth_row
  from public.mcp_oauth_authorizations authorizations
  join public.mcp_oauth_clients clients on clients.client_id = authorizations.client_id
  where authorizations.transaction_hash = p_transaction_hash
    and authorizations.consent_token_hash = p_consent_token_hash
    and authorizations.status = 'awaiting_consent'
    and authorizations.expires_at > now()
    and clients.revoked_at is null
  for update of authorizations;

  if not found then return null; end if;
  if auth_row.user_id is null
    or auth_row.upstream_access_token_ciphertext is null
    or auth_row.upstream_refresh_token_ciphertext is null
    or auth_row.upstream_expires_at is null
  then
    return null;
  end if;

  insert into public.mcp_oauth_grants (
    id, user_id, client_id, resource, granted_scope,
    upstream_access_token_ciphertext, upstream_refresh_token_ciphertext,
    upstream_expires_at
  ) values (
    p_grant_id, auth_row.user_id, auth_row.client_id, auth_row.resource,
    auth_row.requested_scope, auth_row.upstream_access_token_ciphertext,
    auth_row.upstream_refresh_token_ciphertext, auth_row.upstream_expires_at
  );

  insert into public.mcp_oauth_codes (
    code_hash, grant_id, client_id, redirect_uri, resource, requested_scope,
    code_challenge, code_challenge_method, expires_at
  ) values (
    p_code_hash, p_grant_id, auth_row.client_id, auth_row.redirect_uri,
    auth_row.resource, auth_row.requested_scope, auth_row.code_challenge,
    auth_row.code_challenge_method, p_code_expires_at
  );

  update public.mcp_oauth_authorizations
  set status = 'approved',
    consent_token_hash = null,
    upstream_pkce_verifier_ciphertext = null,
    upstream_access_token_ciphertext = null,
    upstream_refresh_token_ciphertext = null,
    upstream_expires_at = null,
    updated_at = now()
  where transaction_hash = p_transaction_hash;

  return jsonb_build_object(
    'redirect_uri', auth_row.redirect_uri,
    'client_state', auth_row.client_state,
    'resource', auth_row.resource
  );
end;
$$;

create function public.mcp_deny_authorization(
  p_transaction_hash text,
  p_consent_token_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  auth_row public.mcp_oauth_authorizations%rowtype;
begin
  select * into auth_row
  from public.mcp_oauth_authorizations
  where transaction_hash = p_transaction_hash
    and consent_token_hash = p_consent_token_hash
    and status = 'awaiting_consent'
    and expires_at > now()
  for update;

  if not found then return null; end if;

  update public.mcp_oauth_authorizations
  set status = 'denied',
    consent_token_hash = null,
    upstream_pkce_verifier_ciphertext = null,
    upstream_access_token_ciphertext = null,
    upstream_refresh_token_ciphertext = null,
    upstream_expires_at = null,
    updated_at = now()
  where transaction_hash = p_transaction_hash;

  return jsonb_build_object(
    'redirect_uri', auth_row.redirect_uri,
    'client_state', auth_row.client_state
  );
end;
$$;

create function public.mcp_exchange_authorization_code(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_resource text,
  p_access_token_hash text,
  p_access_expires_at timestamptz,
  p_refresh_token_hash text,
  p_refresh_family_id uuid,
  p_refresh_expires_at timestamptz
) returns setof public.mcp_oauth_grants
language plpgsql security definer set search_path = '' as $$
declare
  code_row public.mcp_oauth_codes%rowtype;
  grant_row public.mcp_oauth_grants%rowtype;
begin
  select codes.* into code_row
  from public.mcp_oauth_codes codes
  join public.mcp_oauth_clients clients on clients.client_id = codes.client_id
  where codes.code_hash = p_code_hash
    and codes.client_id = p_client_id
    and codes.redirect_uri = p_redirect_uri
    and codes.resource = p_resource
    and codes.consumed_at is null
    and codes.expires_at > now()
    and clients.revoked_at is null
  for update of codes;

  if not found then return; end if;

  select * into grant_row
  from public.mcp_oauth_grants
  where id = code_row.grant_id and revoked_at is null
  for update;

  if not found then return; end if;

  update public.mcp_oauth_codes
  set consumed_at = now()
  where code_hash = p_code_hash;

  insert into public.mcp_oauth_access_tokens(token_hash, grant_id, expires_at)
  values (p_access_token_hash, grant_row.id, p_access_expires_at);

  insert into public.mcp_oauth_refresh_tokens(
    token_hash, grant_id, family_id, generation, expires_at
  ) values (
    p_refresh_token_hash, grant_row.id, p_refresh_family_id, 0, p_refresh_expires_at
  );

  update public.mcp_oauth_grants
  set updated_at = now()
  where id = grant_row.id
  returning * into grant_row;

  return next grant_row;
end;
$$;

create function public.mcp_resolve_access_token(
  p_token_hash text,
  p_resource text
) returns setof public.mcp_oauth_grants
language sql security definer set search_path = '' as $$
  select grants.*
  from public.mcp_oauth_access_tokens tokens
  join public.mcp_oauth_grants grants on grants.id = tokens.grant_id
  join public.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where tokens.token_hash = p_token_hash
    and tokens.expires_at > now()
    and tokens.revoked_at is null
    and grants.revoked_at is null
    and grants.resource = p_resource
    and clients.revoked_at is null;
$$;

create function public.mcp_claim_refresh_token(
  p_token_hash text,
  p_client_id text,
  p_resource text,
  p_claim_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target_grant_id uuid;
  refresh_row public.mcp_oauth_refresh_tokens%rowtype;
  grant_row public.mcp_oauth_grants%rowtype;
begin
  select grant_id into target_grant_id
  from public.mcp_oauth_refresh_tokens
  where token_hash = p_token_hash;

  if target_grant_id is null then return null; end if;

  select grants.* into grant_row
  from public.mcp_oauth_grants grants
  join public.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where grants.id = target_grant_id
    and grants.client_id = p_client_id
    and grants.resource = p_resource
    and clients.revoked_at is null
  for update of grants;

  if not found then return null; end if;

  select * into refresh_row
  from public.mcp_oauth_refresh_tokens
  where token_hash = p_token_hash and grant_id = target_grant_id
  for update;

  if not found then return null; end if;

  if refresh_row.consumed_at is not null or refresh_row.replaced_by_hash is not null then
    if refresh_row.consumed_at is not null
      and refresh_row.consumed_at > now() - interval '30 seconds'
    then
      return jsonb_build_object('replayed', true, 'busy', false, 'grace', true);
    end if;

    update public.mcp_oauth_grants
    set revoked_at = coalesce(revoked_at, now()),
      upstream_access_token_ciphertext = null,
      upstream_refresh_token_ciphertext = null,
      upstream_expires_at = null,
      updated_at = now()
    where id = target_grant_id;

    update public.mcp_oauth_access_tokens
    set revoked_at = coalesce(revoked_at, now())
    where grant_id = target_grant_id;

    update public.mcp_oauth_refresh_tokens
    set revoked_at = coalesce(revoked_at, now()), claim_id = null, claimed_at = null
    where family_id = refresh_row.family_id;

    return jsonb_build_object('replayed', true, 'busy', false, 'grace', false);
  end if;

  if refresh_row.expires_at <= now() and grant_row.revoked_at is null then
    update public.mcp_oauth_grants
    set revoked_at = now(),
      upstream_access_token_ciphertext = null,
      upstream_refresh_token_ciphertext = null,
      upstream_expires_at = null,
      updated_at = now()
    where id = target_grant_id;

    update public.mcp_oauth_access_tokens
    set revoked_at = coalesce(revoked_at, now())
    where grant_id = target_grant_id;

    update public.mcp_oauth_refresh_tokens
    set revoked_at = coalesce(revoked_at, now()), claim_id = null, claimed_at = null
    where grant_id = target_grant_id;

    return null;
  end if;

  if refresh_row.revoked_at is not null or grant_row.revoked_at is not null then
    return null;
  end if;

  if refresh_row.claim_id is not null
    and refresh_row.claimed_at > now() - interval '2 minutes'
    and refresh_row.claim_id <> p_claim_id
  then
    return jsonb_build_object('replayed', false, 'busy', true);
  end if;

  update public.mcp_oauth_refresh_tokens
  set claim_id = p_claim_id, claimed_at = now()
  where token_hash = p_token_hash;

  return to_jsonb(grant_row) || jsonb_build_object(
    'replayed', false,
    'busy', false,
    'refresh_family_id', refresh_row.family_id,
    'refresh_generation', refresh_row.generation,
    'refresh_claim_id', p_claim_id
  );
end;
$$;

create function public.mcp_complete_refresh(
  p_grant_id uuid,
  p_current_refresh_token_hash text,
  p_refresh_claim_id uuid,
  p_refresh_family_id uuid,
  p_refresh_generation integer,
  p_new_access_token_hash text,
  p_new_access_expires_at timestamptz,
  p_new_refresh_token_hash text,
  p_new_refresh_expires_at timestamptz,
  p_upstream_access_token_ciphertext text,
  p_upstream_refresh_token_ciphertext text,
  p_upstream_expires_at timestamptz
) returns setof public.mcp_oauth_grants
language plpgsql security definer set search_path = '' as $$
declare
  current_refresh public.mcp_oauth_refresh_tokens%rowtype;
  grant_row public.mcp_oauth_grants%rowtype;
begin
  select grants.* into grant_row
  from public.mcp_oauth_grants grants
  join public.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where grants.id = p_grant_id
    and grants.revoked_at is null
    and clients.revoked_at is null
  for update of grants;

  if not found then return; end if;

  select * into current_refresh
  from public.mcp_oauth_refresh_tokens
  where token_hash = p_current_refresh_token_hash
    and grant_id = p_grant_id
    and family_id = p_refresh_family_id
    and generation = p_refresh_generation
    and claim_id = p_refresh_claim_id
    and claimed_at > now() - interval '2 minutes'
    and consumed_at is null
    and replaced_by_hash is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then return; end if;

  insert into public.mcp_oauth_access_tokens(token_hash, grant_id, expires_at)
  values (p_new_access_token_hash, p_grant_id, p_new_access_expires_at);

  insert into public.mcp_oauth_refresh_tokens(
    token_hash, grant_id, family_id, generation, expires_at
  ) values (
    p_new_refresh_token_hash, p_grant_id, p_refresh_family_id,
    p_refresh_generation + 1, p_new_refresh_expires_at
  );

  update public.mcp_oauth_refresh_tokens
  set consumed_at = now(),
    replaced_by_hash = p_new_refresh_token_hash,
    claim_id = null,
    claimed_at = null
  where token_hash = p_current_refresh_token_hash;

  update public.mcp_oauth_grants
  set upstream_access_token_ciphertext = p_upstream_access_token_ciphertext,
    upstream_refresh_token_ciphertext = p_upstream_refresh_token_ciphertext,
    upstream_expires_at = p_upstream_expires_at,
    updated_at = now()
  where id = p_grant_id
  returning * into grant_row;

  return next grant_row;
end;
$$;

create function public.mcp_release_refresh_claim(
  p_token_hash text,
  p_claim_id uuid
) returns void
language sql security definer set search_path = '' as $$
  update public.mcp_oauth_refresh_tokens
  set claim_id = null, claimed_at = null
  where token_hash = p_token_hash
    and claim_id = p_claim_id
    and consumed_at is null
    and replaced_by_hash is null;
$$;

create function public.mcp_revoke_grant(p_grant_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.mcp_oauth_grants where id = p_grant_id for update;

  update public.mcp_oauth_grants
  set revoked_at = coalesce(revoked_at, now()),
    upstream_access_token_ciphertext = null,
    upstream_refresh_token_ciphertext = null,
    upstream_expires_at = null,
    updated_at = now()
  where id = p_grant_id;

  update public.mcp_oauth_access_tokens
  set revoked_at = coalesce(revoked_at, now())
  where grant_id = p_grant_id;

  update public.mcp_oauth_refresh_tokens
  set revoked_at = coalesce(revoked_at, now()), claim_id = null, claimed_at = null
  where grant_id = p_grant_id;
end;
$$;

create function public.mcp_revoke_grant_by_token(
  p_token_hash text,
  p_client_id text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  target_grant_id uuid;
begin
  select grants.id into target_grant_id
  from public.mcp_oauth_grants grants
  where grants.client_id = p_client_id
    and grants.id in (
      select grant_id from public.mcp_oauth_access_tokens where token_hash = p_token_hash
      union
      select grant_id from public.mcp_oauth_refresh_tokens where token_hash = p_token_hash
    )
  limit 1;

  if target_grant_id is null then return false; end if;

  perform 1 from public.mcp_oauth_grants where id = target_grant_id for update;

  update public.mcp_oauth_grants
  set revoked_at = coalesce(revoked_at, now()),
    upstream_access_token_ciphertext = null,
    upstream_refresh_token_ciphertext = null,
    upstream_expires_at = null,
    updated_at = now()
  where id = target_grant_id;

  update public.mcp_oauth_access_tokens
  set revoked_at = coalesce(revoked_at, now())
  where grant_id = target_grant_id;

  update public.mcp_oauth_refresh_tokens
  set revoked_at = coalesce(revoked_at, now()), claim_id = null, claimed_at = null
  where grant_id = target_grant_id;

  return true;
end;
$$;

create function public.mcp_cleanup_expired_oauth_records()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  orphaned_grant record;
begin
  -- A grant is reachable only while it has an exchangeable authorization code
  -- or a live refresh token. Revoke orphaned grants before deleting their rows
  -- so encrypted upstream Supabase credentials are cleared immediately.
  for orphaned_grant in
    select grants.id
    from public.mcp_oauth_grants grants
    where grants.revoked_at is null
      and not exists (
        select 1
        from public.mcp_oauth_codes codes
        where codes.grant_id = grants.id
          and codes.consumed_at is null
          and codes.expires_at > now()
      )
      and not exists (
        select 1
        from public.mcp_oauth_refresh_tokens refresh_tokens
        where refresh_tokens.grant_id = grants.id
          and refresh_tokens.consumed_at is null
          and refresh_tokens.replaced_by_hash is null
          and refresh_tokens.revoked_at is null
          and refresh_tokens.expires_at > now()
      )
    for update of grants skip locked
  loop
    update public.mcp_oauth_grants
    set revoked_at = now(),
      upstream_access_token_ciphertext = null,
      upstream_refresh_token_ciphertext = null,
      upstream_expires_at = null,
      updated_at = now()
    where id = orphaned_grant.id;

    update public.mcp_oauth_access_tokens
    set revoked_at = coalesce(revoked_at, now())
    where grant_id = orphaned_grant.id;

    update public.mcp_oauth_refresh_tokens
    set revoked_at = coalesce(revoked_at, now()), claim_id = null, claimed_at = null
    where grant_id = orphaned_grant.id;
  end loop;

  delete from public.mcp_oauth_authorizations
  where expires_at < now() - interval '1 day';

  delete from public.mcp_oauth_codes
  where expires_at < now() - interval '1 day';

  delete from public.mcp_oauth_access_tokens
  where expires_at < now() - interval '7 days';

  delete from public.mcp_oauth_refresh_tokens
  where expires_at < now() - interval '7 days';

  delete from public.mcp_oauth_grants
  where revoked_at < now() - interval '30 days';

  delete from public.mcp_oauth_clients clients
  where clients.created_at < now() - interval '7 days'
    and not exists (
      select 1 from public.mcp_oauth_authorizations authorizations
      where authorizations.client_id = clients.client_id
    )
    and not exists (
      select 1 from public.mcp_oauth_grants grants
      where grants.client_id = clients.client_id
    );

  delete from public.mcp_oauth_rate_limits
  where window_start < now() - interval '2 days';
end;
$$;

revoke all on function public.mcp_consume_oauth_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.mcp_complete_authorization_login(text, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.mcp_approve_authorization(text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mcp_deny_authorization(text, text) from public, anon, authenticated;
revoke all on function public.mcp_exchange_authorization_code(text, text, text, text, text, timestamptz, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mcp_resolve_access_token(text, text) from public, anon, authenticated;
revoke all on function public.mcp_claim_refresh_token(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.mcp_complete_refresh(uuid, text, uuid, uuid, integer, text, timestamptz, text, timestamptz, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mcp_release_refresh_claim(text, uuid) from public, anon, authenticated;
revoke all on function public.mcp_revoke_grant(uuid) from public, anon, authenticated;
revoke all on function public.mcp_revoke_grant_by_token(text, text) from public, anon, authenticated;
revoke all on function public.mcp_cleanup_expired_oauth_records() from public, anon, authenticated;

grant execute on function public.mcp_consume_oauth_rate_limit(text, text, timestamptz, integer) to service_role;
grant execute on function public.mcp_complete_authorization_login(text, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.mcp_approve_authorization(text, text, uuid, text, timestamptz) to service_role;
grant execute on function public.mcp_deny_authorization(text, text) to service_role;
grant execute on function public.mcp_exchange_authorization_code(text, text, text, text, text, timestamptz, text, uuid, timestamptz) to service_role;
grant execute on function public.mcp_resolve_access_token(text, text) to service_role;
grant execute on function public.mcp_claim_refresh_token(text, text, text, uuid) to service_role;
grant execute on function public.mcp_complete_refresh(uuid, text, uuid, uuid, integer, text, timestamptz, text, timestamptz, text, text, timestamptz) to service_role;
grant execute on function public.mcp_release_refresh_claim(text, uuid) to service_role;
grant execute on function public.mcp_revoke_grant(uuid) to service_role;
grant execute on function public.mcp_revoke_grant_by_token(text, text) to service_role;
grant execute on function public.mcp_cleanup_expired_oauth_records() to service_role;
