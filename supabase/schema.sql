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

-- Deck manager: favorites, play counts, a per-account default deck, and a hard cap of 20 decks per account.
alter table public.decks add column if not exists favorite boolean not null default false;
alter table public.decks add column if not exists plays integer not null default 0;
alter table public.decks add column if not exists last_played_at timestamptz;
alter table public.profiles add column if not exists default_deck_id uuid;
create or replace function public.enforce_deck_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.decks where user_id = new.user_id) >= 20 then
    raise exception 'Deck limit reached: each account can keep up to 20 decks' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger decks_limit before insert on public.decks for each row execute function public.enforce_deck_limit();

-- Game persistence: the current host saves the whole table here; whoever comes back first restores it.
create table if not exists public.room_state (
  code text primary key references public.rooms(code) on delete cascade,
  state jsonb not null,
  voice_url text,
  saved_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.room_state enable row level security;
create policy "room state readable" on public.room_state for select using (true);
create policy "seated users write room state" on public.room_state for insert with check (auth.uid() is not null);
create policy "seated users update room state" on public.room_state for update using (auth.uid() is not null);

-- Who sat where: lets a player find and resume their tables from any device.
create table if not exists public.room_players (
  code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat int not null,
  name text,
  last_seen timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.room_players enable row level security;
create policy "room players readable" on public.room_players for select using (true);
create policy "own room player row insert" on public.room_players for insert with check (auth.uid() = user_id);
create policy "own room player row update" on public.room_players for update using (auth.uid() = user_id);
create policy "own room player row delete" on public.room_players for delete using (auth.uid() = user_id);
create index if not exists room_players_user_idx on public.room_players(user_id, last_seen desc);

-- Any seated player may update the room's status (host handoff), not only its creator.
drop policy if exists "host updates room" on public.rooms;
create policy "seated players update room" on public.rooms for update using (
  auth.uid() = host_id or exists (select 1 from public.room_players rp where rp.code = rooms.code and rp.user_id = auth.uid())
);

-- Live occupancy and lock for open-table listings; Discord announcement bookkeeping.
alter table public.rooms add column if not exists seated int not null default 0;
alter table public.rooms add column if not exists open_seats int;
alter table public.rooms add column if not exists locked boolean not null default false;
alter table public.rooms add column if not exists announced_at timestamptz;
alter table public.rooms add column if not exists has_voice boolean not null default false;
alter table public.rooms add column if not exists title text;
create index if not exists rooms_open_idx on public.rooms(status, is_public, created_at desc);

-- Clubs may point a Discord webhook at their channel: club tables get announced there.
alter table public.clubs add column if not exists discord_webhook text;
drop policy if exists "owner updates club" on public.clubs;
create policy "owner updates club" on public.clubs for update using (auth.uid() = owner_id);

-- Blocks: hide a player's chat and keep them out of tables you host.
create table if not exists public.blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  blocked_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id)
);
alter table public.blocks enable row level security;
create policy "own blocks readable" on public.blocks for select using (auth.uid() = user_id);
create policy "own blocks insert" on public.blocks for insert with check (auth.uid() = user_id);
create policy "own blocks delete" on public.blocks for delete using (auth.uid() = user_id);

-- Reports: reviewed by hand; the reporter can write, nobody reads through the API.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reported_id uuid,
  reported_name text,
  room_code text,
  reason text not null,
  details text,
  log jsonb,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy "signed-in users file reports" on public.reports for insert with check (auth.uid() = reporter_id);

-- Delete my own account (profile, decks, memberships cascade from auth.users).
create or replace function public.delete_me() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_me() from public;
grant execute on function public.delete_me() to authenticated;
-- Stats tracker + tournaments.

-- ---------- admins (tournaments are run by site admins only) ----------
create table if not exists public.app_admins (
  email text primary key,
  user_id uuid,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins a where (a.email is not null and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))) or (a.user_id is not null and a.user_id = auth.uid()))
$$;
grant execute on function public.is_admin() to anon, authenticated;
insert into public.app_admins (email) values ('trevorkeithsherman@gmail.com') on conflict do nothing;

-- ---------- games: richer record of every finished game ----------
alter table public.games add column if not exists mode text not null default 'room';            -- room | bots | hotseat
alter table public.games add column if not exists seats int;
alter table public.games add column if not exists turns int;                                     -- rounds when the game ended
alter table public.games add column if not exists winner_id uuid;
alter table public.games add column if not exists winner_deck_id uuid;
alter table public.games add column if not exists win_method text;                               -- combat | commander | combo | poison | alt | other | concede
alter table public.games add column if not exists started_at timestamptz;
alter table public.games add column if not exists duration_s int;
alter table public.games add column if not exists bracket int;
alter table public.games add column if not exists vs_bots boolean not null default false;
alter table public.games add column if not exists recorded_by uuid;
create policy "recorder updates game" on public.games for update using (auth.uid() = recorded_by);
create index if not exists games_room_idx on public.games (room_code, ended_at desc);

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid,                      -- null for bots and guests we couldn't identify
  name text,
  bot boolean not null default false,
  seat int,                          -- table seat
  turn_order int,                    -- 1 = went first
  deck_id uuid,
  deck_name text,
  commander text,
  colors text,
  placement int,                     -- 1 = winner … n = first out
  eliminated_turn int,
  eliminated_by_seat int,
  eliminated_how text,               -- combat | commander | poison | life | concede
  kills int not null default 0,
  mulligans int not null default 0,
  cmd_dmg_dealt int not null default 0,
  dmg_dealt int not null default 0,
  life_end int,
  created_at timestamptz not null default now()
);
alter table public.game_players enable row level security;
create policy "game players readable" on public.game_players for select using (true);
create policy "signed-in users record game players" on public.game_players for insert with check (auth.uid() is not null);
create index if not exists game_players_user_idx on public.game_players (user_id, created_at desc);
create index if not exists game_players_deck_idx on public.game_players (deck_id);

-- ---------- tournaments ----------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  status text not null default 'coming_soon' check (status in ('coming_soon', 'open', 'running', 'finished')),
  starts_at timestamptz,
  pod_size int not null default 4 check (pod_size between 2 and 4),
  bracket int not null default 3,
  champion_id uuid,
  champion_name text,
  champion_pod_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.tournaments enable row level security;
create policy "tournaments readable" on public.tournaments for select using (true);
create policy "admins manage tournaments" on public.tournaments for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.tournament_pods (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  join_code text not null,
  captain_id uuid,
  seed int,
  winner_id uuid,                    -- the pod's champion after the pod round
  created_at timestamptz not null default now(),
  unique (tournament_id, join_code)
);
alter table public.tournament_pods enable row level security;
create policy "pods readable" on public.tournament_pods for select using (true);
create policy "signed-in users create pods while open" on public.tournament_pods for insert with check (auth.uid() = captain_id and exists (select 1 from public.tournaments t where t.id = tournament_id and t.status = 'open'));
create policy "captain or admin updates pod" on public.tournament_pods for update using (auth.uid() = captain_id or public.is_admin());
create policy "captain or admin deletes pod" on public.tournament_pods for delete using (auth.uid() = captain_id or public.is_admin());

create table if not exists public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  pod_id uuid references public.tournament_pods(id) on delete set null,
  user_id uuid not null,
  display_name text,
  deck_id uuid,
  deck_name text,
  commander text,
  created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
alter table public.tournament_members enable row level security;
create policy "members readable" on public.tournament_members for select using (true);
create policy "sign up while open" on public.tournament_members for insert with check (auth.uid() = user_id and exists (select 1 from public.tournaments t where t.id = tournament_id and t.status = 'open'));
create policy "own membership or admin update" on public.tournament_members for update using (auth.uid() = user_id or public.is_admin());
create policy "own membership or admin delete" on public.tournament_members for delete using (auth.uid() = user_id or public.is_admin());

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round int not null default 1,
  kind text not null default 'pod' check (kind in ('pod', 'final')),
  pod_id uuid references public.tournament_pods(id) on delete set null,
  room_code text,
  status text not null default 'pending' check (status in ('pending', 'live', 'done')),
  players jsonb not null default '[]',   -- [{user_id, name, pod_id, pod_name}]
  winner_id uuid,
  winner_name text,
  game_id uuid,
  created_at timestamptz not null default now()
);
alter table public.tournament_matches enable row level security;
create policy "matches readable" on public.tournament_matches for select using (true);
create policy "admins manage matches" on public.tournament_matches for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.tournament_interest (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_interest enable row level security;
create policy "interest readable" on public.tournament_interest for select using (true);
create policy "own interest" on public.tournament_interest for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- rooms: tournament tables stay off the public list and remember their match
alter table public.rooms add column if not exists match_id uuid;

-- the first tournament, coming soon
insert into public.tournaments (slug, name, description, status, pod_size)
values ('open-season-1', 'EDH Club Open — Season 1', 'The first EDH Club tournament. Sign up with your pod of four, play your pod round at your own table, and send your champion to the final table. The winning player takes the title and their pod takes the banner.', 'coming_soon', 4)
on conflict (slug) do nothing;
