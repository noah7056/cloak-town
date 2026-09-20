-- Cloak Town account system: profiles + friendships.
-- Paste this into your Supabase project SQL editor and run it once.
-- Project: https://ajnvxoarntvrazkzfqvv.supabase.co
--
-- Guest play keeps working: the game server still accepts players with no
-- userId. Logging in just links your persistent Supabase user id to your
-- in-game presence so friends can find you.

-- ---------- profiles ----------
-- One row per auth user. Auto-created on signup (see trigger below);
-- users then pick a unique username + display name + bio.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text not null default '',
  bio text not null default '',
  avatar jsonb not null default '{}'::jsonb,
  -- public URL of the uploaded profile picture (Supabase Storage `avatars`
  -- bucket, path `<uid>/avatar.ext`). Empty = default cloakling look.
  avatar_url text not null default '',
  -- profile card extras: home country, up to two languages, card
  -- background (#rrggbb or '' for default), picture zoom/focus
  country text not null default '',
  languages text[] not null default '{}',
  card_color text not null default '',
  card_color2 text not null default '',
  card_text text not null default '',
  avatar_crop jsonb not null default '{"zoom":1,"x":50,"y":50}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (
    username is null or username ~ '^[a-zA-Z0-9_]{3,20}$'
  )
);

-- ---------- friendships ----------
-- One row per directed request. status lifecycle:
--   pending -> accepted (friends) | declined/cancelled (deleted by app)
--   blocked (optional: addressee hides requester)
-- The app checks both directions before inserting so there is never a
-- duplicate pending pair.
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_friend check (requester_id <> addressee_id),
  constraint unique_pair unique (requester_id, addressee_id)
);

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);

-- ---------- auto-create profile on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  disp text;
begin
  base := coalesce(
    nullif(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'), ''),
    'cloakling'
  );
  -- OAuth logins (Discord/Google) carry a ready-made name in user_metadata.
  disp := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    base
  );
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    left(base || '_' || substr(md5(new.id::text), 1, 4), 20),
    left(disp, 24)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at touch ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists friendships_touch on public.friendships;
create trigger friendships_touch
  before update on public.friendships
  for each row execute function public.touch_updated_at();

-- ---------- grants (RLS policies alone are NOT enough) ----------
-- Tables created via raw SQL get no privileges by default, so every query
-- fails with "permission denied" even with correct policies. Re-run safe.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;

-- ---------- room invites (join-me-from-anywhere) ----------
-- A player invites a friend to their current room. The friend polls these
-- (rooms are ephemeral, so invites can't ride the game server) and joins by
-- code from the lobby or mid-game. Rows are pending until accepted/declined;
-- anything older than a couple minutes counts as expired client-side and is
-- ignored (sender/receiver delete rows on accept/decline).
create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  room_code text not null,
  server_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint no_self_invite check (from_id <> to_id)
);

create index if not exists room_invites_to_idx
  on public.room_invites (to_id, status, created_at desc);

alter table public.room_invites enable row level security;

-- only the two involved parties ever see a row
drop policy if exists "room_invites visible to parties" on public.room_invites;
create policy "room_invites visible to parties"
  on public.room_invites for select
  to authenticated
  using (auth.uid() = from_id or auth.uid() = to_id);

-- invites are always sent as yourself...
drop policy if exists "room_invites send as self" on public.room_invites;
create policy "room_invites send as self"
  on public.room_invites for insert
  to authenticated
  with check (auth.uid() = from_id);

-- ...the recipient accepts/declines, either side cleans up
drop policy if exists "room_invites update as party" on public.room_invites;
create policy "room_invites update as party"
  on public.room_invites for update
  to authenticated
  using (auth.uid() = from_id or auth.uid() = to_id)
  with check (auth.uid() = from_id or auth.uid() = to_id);

drop policy if exists "room_invites delete as party" on public.room_invites;
create policy "room_invites delete as party"
  on public.room_invites for delete
  to authenticated
  using (auth.uid() = from_id or auth.uid() = to_id);

-- privileges for the API roles (must come AFTER the table exists)
grant select, insert, update, delete on public.room_invites to authenticated;

-- ---------- gallery (profile photo wall) ----------
-- Photos saved from the camera menu. Files live in the `gallery` storage
-- bucket at `<uid>/<uuid>.jpg`; rows carry pin state. Anything authenticated
-- can browse (profiles work the same way); only the owner writes.
create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  path text not null,
  pinned boolean not null default false,
  pinned_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gallery_owner_idx
  on public.gallery_items (owner_id, created_at desc);

alter table public.gallery_items enable row level security;

drop policy if exists "gallery readable by signed-in users" on public.gallery_items;
create policy "gallery readable by signed-in users"
  on public.gallery_items for select
  to authenticated
  using (true);

drop policy if exists "gallery insert own" on public.gallery_items;
create policy "gallery insert own"
  on public.gallery_items for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "gallery update own" on public.gallery_items;
create policy "gallery update own"
  on public.gallery_items for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "gallery delete own" on public.gallery_items;
create policy "gallery delete own"
  on public.gallery_items for delete
  to authenticated
  using (auth.uid() = owner_id);

grant select, insert, update, delete on public.gallery_items to authenticated;

insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

drop policy if exists "gallery public read" on storage.objects;
create policy "gallery public read"
  on storage.objects for select
  using (bucket_id = 'gallery');

drop policy if exists "gallery upload own" on storage.objects;
create policy "gallery upload own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "gallery update own" on storage.objects;
create policy "gallery update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "gallery delete own" on storage.objects;
create policy "gallery delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- late columns (for DBs created before they existed) ----------
alter table public.profiles
  add column if not exists avatar_url text not null default '';
alter table public.profiles
  add column if not exists country text not null default '';
alter table public.profiles
  add column if not exists languages text[] not null default '{}';
alter table public.profiles
  add column if not exists card_color text not null default '';
alter table public.profiles
  add column if not exists card_color2 text not null default '';
alter table public.profiles
  add column if not exists card_text text not null default '';
alter table public.profiles
  add column if not exists avatar_crop jsonb not null default '{"zoom":1,"x":50,"y":50}'::jsonb;
-- at most two languages; card color is empty (default) or #rrggbb
alter table public.profiles
  drop constraint if exists languages_max_two;
alter table public.profiles
  add constraint languages_max_two check (
    array_length(languages, 1) is null or array_length(languages, 1) <= 2
  );
alter table public.profiles
  drop constraint if exists card_color_format;
alter table public.profiles
  add constraint card_color_format check (
    card_color = '' or card_color ~ '^#[0-9a-fA-F]{6}$'
  );
alter table public.profiles
  drop constraint if exists card_color2_format;
alter table public.profiles
  add constraint card_color2_format check (
    card_color2 = '' or card_color2 ~ '^#[0-9a-fA-F]{6}$'
  );
alter table public.profiles
  drop constraint if exists card_text_format;
alter table public.profiles
  add constraint card_text_format check (
    card_text = '' or card_text ~ '^#[0-9a-fA-F]{6}$'
  );

-- ---------- profile pictures (Supabase Storage) ----------
-- Public bucket; each user may only write under their own `<uid>/` folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars upload own" on storage.objects;
create policy "avatars upload own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- self-serve account deletion ----------
-- The client can't call auth.admin (service key only), so this
-- security-definer RPC lets a signed-in user delete their own auth user.
-- Profiles + friendships cascade via FKs. Irreversible on purpose.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;

-- profiles: anyone signed in can read (needed for friend search);
-- users can insert/update only their own row.
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- friendships: only the two involved parties can see a row.
drop policy if exists "friendships visible to parties" on public.friendships;
create policy "friendships visible to parties"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- anyone signed in can request (as themselves)...
drop policy if exists "friendships request as self" on public.friendships;
create policy "friendships request as self"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

-- ...the addressee accepts/blocks, either side cancels (delete).
drop policy if exists "friendships update as party" on public.friendships;
create policy "friendships update as party"
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships delete as party" on public.friendships;
create policy "friendships delete as party"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
