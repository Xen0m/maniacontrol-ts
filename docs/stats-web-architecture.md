# Stats Web Architecture

## Goal

Keep `maniacontrol-companion` focused on live administration and build a separate web surface for:

- local records
- historical stats
- leaderboards
- player pages
- map pages
- match history

The companion remains the control room.
The website becomes the long-term read model.

## Product split

### Companion

Use the desktop app for:

- live server health
- realtime Elite state
- player administration
- sanctions
- map rotation
- imports
- mode controls
- chat / notices / votes

### Website

Use the website for:

- browsing records and rankings
- searching players and maps
- viewing historical performance
- comparing sessions over time
- exposing public or semi-public stats

This split prevents the companion from turning into a reporting dashboard with poor navigation.

## Proposed architecture

### 1. Dedicated server runtime

`maniacontrol-ts` keeps the authoritative GBXRemote connection and callback handling.

It continues to:

- authenticate with the dedicated server
- receive callbacks
- normalize events
- execute admin actions

### 2. Domain event layer

The next stable layer should be a domain event stream produced by the controller.

Typical events:

- `server.player.connect`
- `server.player.disconnect`
- `server.map.begin`
- `server.map.end`
- `elite.turn.start`
- `elite.turn.end`
- `server.vote.called`
- `server.map.changed`
- `admin.action.executed`
- `records.snapshot.updated`

This event stream is the correct place to decouple transport/callback noise from business data.

### 3. Persistence layer

Use a real storage module for long-lived data.

Recommended progression:

1. SQLite for local single-server deployments
2. PostgreSQL when multiple servers, more traffic, or public stats matter

Short-term acceptable approach:

- keep JSONL/json snapshots for bootstrapping

Target approach:

- structured relational tables
- migrations
- explicit repositories

### 4. Read-model / stats projection layer

Build projections from domain events into queryable tables.

Examples:

- current player profile
- per-map records
- leaderboard aggregates
- per-match summaries
- Elite player stats
- vote history

This layer should be optimized for reads, not controller actions.

### 5. Admin API

Keep the current private admin API for the companion.

It remains:

- bearer-token protected
- action-oriented
- low-latency
- private

### 6. Stats API

Add a separate stats-oriented HTTP API.

It should be:

- read-only for most consumers
- query-oriented
- pagination/filter friendly
- safe to expose behind normal web auth or even publicly for selected endpoints

Example route families:

- `/stats/players`
- `/stats/players/:login`
- `/stats/maps`
- `/stats/maps/:mapUid`
- `/stats/records`
- `/stats/leaderboards`
- `/stats/matches`
- `/stats/elite`

### 7. Web frontend

Build a dedicated web frontend against the stats API.

Recommended characteristics:

- server-rendered or hybrid app
- search/filter first
- responsive
- public-safe by default
- optional private admin views later

## Data model

The exact schema can evolve, but these entities are the right base.

### Core entities

- `players`
- `maps`
- `servers`
- `sessions`
- `matches`
- `match_maps`

### Event / history entities

- `domain_events`
- `admin_actions`
- `vote_history`
- `sanctions_history`
- `chat_announcements`

### Stats / projection entities

- `player_map_stats`
- `player_match_stats`
- `player_elite_stats`
- `map_records`
- `map_record_history`
- `leaderboard_snapshots`
- `map_rotation_history`

## Recommended minimal schema

### `players`

- `id`
- `login`
- `latest_nickname`
- `first_seen_at`
- `last_seen_at`

### `maps`

- `id`
- `uid`
- `name`
- `file_name`
- `author`
- `environment`
- `map_type`
- `first_seen_at`

### `matches`

- `id`
- `server_id`
- `started_at`
- `ended_at`
- `title_id`
- `mode_name`
- `winner_team`

### `elite_turns`

- `id`
- `match_id`
- `turn_number`
- `attacker_login`
- `victory_type`
- `started_at`
- `ended_at`

### `map_records`

- `id`
- `map_id`
- `player_id`
- `best_time`
- `best_score`
- `updated_at`

### `player_map_stats`

- `id`
- `player_id`
- `map_id`
- `plays`
- `wins`
- `best_time`
- `best_score`
- `last_played_at`

## Read APIs to build first

### MVP endpoints

- `GET /stats/overview`
- `GET /stats/records/current-map`
- `GET /stats/records/maps`
- `GET /stats/leaderboards/players`
- `GET /stats/players/:login`
- `GET /stats/maps/:mapUid`

### Companion-facing endpoints that can remain private

- current local records
- current live ranking
- recent activity
- recent admin actions

## Suggested pages for the site

### MVP pages

- `/`
  summary cards, current server status, latest records, latest activity

- `/records`
  latest records and per-map bests

- `/players`
  searchable player list

- `/players/:login`
  player profile, recent matches, records, win/loss summary

- `/maps`
  searchable map list

- `/maps/:mapUid`
  map metadata, local records, recent plays

### Phase 2 pages

- `/matches`
- `/matches/:id`
- `/elite`
- `/votes`
- `/sanctions`

## Suggested implementation phases

### Phase 1

Goal: make current local records and live ranking visible on the web.

- create stats API module
- expose current records + map list records
- expose current ranking
- build a simple records/leaderboard frontend

### Phase 2

Goal: persist real player/map/match history.

- add relational storage
- add migrations
- persist players/maps/matches
- persist Elite turns
- persist map-end ranking snapshots

### Phase 3

Goal: provide true player and map pages.

- player aggregates
- map aggregates
- leaderboards
- recent match pages

### Phase 4

Goal: expand into public stats comparable to a real ManiaControl ecosystem.

- richer records
- vote history
- sanctions history
- public/private access split
- multi-server support

## Technology recommendation

### Backend

Keep this inside `maniacontrol-ts` initially:

- `src/stats-api`
- `src/storage`
- `src/projections`

This avoids unnecessary service sprawl early.

### Frontend

Create a separate repository or app such as:

- `maniacontrol-web`

Recommended stack:

- Next.js or another SSR-capable frontend
- direct HTTP calls to the stats API

Why separate:

- cleaner deployment model
- public site can evolve independently
- companion stays small and admin-focused

## Security model

### Admin API

- private
- bearer/scoped
- not publicly exposed unless properly protected

### Stats API

Split into:

- public read endpoints
- private/admin read endpoints

Examples:

- public: leaderboards, map records, player pages
- private: sanctions, internal audit, operational logs

## What not to do

- do not force the companion to become the stats website
- do not keep all long-term stats in ad-hoc JSONL forever
- do not expose the admin action API directly as the public website backend
- do not couple frontend pages directly to raw dedicated-server payloads

## Recommended next concrete step

The best next implementation step is:

1. create a `stats-api` module in `maniacontrol-ts`
2. expose current local records and ranking through stable read endpoints
3. scaffold `maniacontrol-web`
4. implement three pages first:
   - home
   - records
   - player profile

That gives a useful public-facing read surface without destabilizing the current admin companion.
