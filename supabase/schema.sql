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
