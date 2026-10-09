-- EDH Club schema. Apply with the Supabase MCP tool or the SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Planeswalker',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles are readable" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

create table if not exists public.rooms (
  code text primary key,
  host_id uuid references auth.users(id) on delete set null,
  host_name text,
  seats int not null default 4 check (seats between 2 and 4),
  bots int not null default 0,
  bracket int not null default 3,
  is_public boolean not null default true,
  status text not null default 'open',
  club_id uuid,
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create policy "rooms are readable" on public.rooms for select using (true);
create policy "signed-in users create rooms" on public.rooms for insert with check (auth.uid() = host_id);
create policy "host updates room" on public.rooms for update using (auth.uid() = host_id);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
create policy "clubs readable by anyone" on public.clubs for select using (true);
create policy "signed-in users create clubs" on public.clubs for insert with check (auth.uid() = owner_id);
create policy "members see memberships" on public.club_members for select using (true);
create policy "join a club" on public.club_members for insert with check (auth.uid() = user_id);
create policy "leave a club" on public.club_members for delete using (auth.uid() = user_id);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text,
  club_id uuid references public.clubs(id) on delete set null,
  winner_name text,
  players jsonb not null default '[]',
  rounds int,
  ended_at timestamptz not null default now()
);
alter table public.games enable row level security;
create policy "games readable" on public.games for select using (true);
create policy "signed-in users record games" on public.games for insert with check (auth.uid() is not null);

-- Profile pictures: a public bucket where each user can only write inside their own folder.
alter table public.profiles add column if not exists avatar_url text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
create policy "avatars are public" on storage.objects for select using (bucket_id = 'avatars');
create policy "own avatar insert" on storage.objects for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar update" on storage.objects for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar delete" on storage.objects for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
