-- Proposal only. Run in a new Supabase project after reviewing policies.
create extension if not exists pgcrypto;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  map_seed bigint not null,
  snapshot jsonb not null,
  state_version bigint not null default 0,
  current_turn integer not null default 1,
  current_player_slot smallint not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slot smallint not null check (player_slot between 0 and 7),
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, player_slot)
);

create table public.game_commands (
  game_id uuid not null references public.games(id) on delete cascade,
  sequence bigint not null,
  actor_id uuid not null references auth.users(id),
  expected_version bigint not null,
  resulting_version bigint not null,
  command jsonb not null,
  events jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, sequence),
  unique (game_id, resulting_version)
);

create index game_players_user_idx on public.game_players(user_id, game_id);
create index game_commands_game_version_idx on public.game_commands(game_id, resulting_version);

alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_commands enable row level security;

create policy "participants read games"
on public.games for select to authenticated
using (exists (
  select 1 from public.game_players gp
  where gp.game_id = games.id and gp.user_id = auth.uid()
));

create policy "participants read memberships"
on public.game_players for select to authenticated
using (exists (
  select 1 from public.game_players self
  where self.game_id = game_players.game_id and self.user_id = auth.uid()
));

create policy "participants read command log"
on public.game_commands for select to authenticated
using (exists (
  select 1 from public.game_players gp
  where gp.game_id = game_commands.game_id and gp.user_id = auth.uid()
));

-- Intentionally no direct INSERT/UPDATE/DELETE policies for games or commands.
-- A trusted command-validation Edge Function writes through service-role access
-- after authenticating membership, turn ownership, expected_version and rules.

