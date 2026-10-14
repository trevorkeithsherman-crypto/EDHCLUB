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
