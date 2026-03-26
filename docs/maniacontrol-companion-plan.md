# ManiaControl Companion Plan

## Goal

Build `maniacontrol-companion`, a desktop admin app for ShootMania / ManiaControl TS, by reusing the Electron base from `horadric-companion` and replacing the domain logic with a secure admin API exposed by `maniacontrol-ts`.

## Target Architecture

1. `maniacontrol-ts`
- keeps server logic
- keeps XML-RPC connection to the ManiaPlanet dedicated server
- exposes a private admin API

2. `maniacontrol-companion`
- Electron desktop app
- connects only to the `maniacontrol-ts` admin API
- never talks directly to the ManiaPlanet dedicated server

3. In-game
- keep only a minimal Elite status widget
- keep lightweight notifications
- keep chat commands as fallback

## Phase 1: Scope

### MVP

- view Elite state
- pause / resume match
- search ShootMania Exchange
- import SMX maps
- view action logs
- view connection / health state

### Out of Scope for MVP

- advanced player management
- advanced vote management
- role / permission system
- full matchsettings editor
- ManiaScript HUD replacement

### Security Constraints

- private admin API
- token required
- XML-RPC never exposed to the companion
- use LAN / VPN / protected reverse proxy for remote access

## Phase 2: Refork From Horadric Companion

1. Create a new project:
- `maniacontrol-companion`

2. Reuse the Electron base from `horadric-companion`:
- app shell
- `main / preload / renderer` split
- runtime settings pattern
- packaging setup

3. Remove D2R-specific features:
- overlay
- snipping
- OCR or game-specific renderer logic

4. Rebrand:
- `package.json`
- `productName`
- `appId`
- window titles
- basic branding

## Phase 3: Admin API in maniacontrol-ts

### Core HTTP Server

- add a dedicated module, for example `src/admin-http/*`
- configurable host
- configurable port
- configurable API token

### Initial Endpoints

- `GET /health`
- `GET /elite/state`
- `POST /elite/pause`
- `POST /elite/resume`
- `GET /mx/search?q=...`
- `POST /mx/import`
- `GET /server/info`
- `GET /server/maps/current`
- optional later: `GET /server/players`

### Realtime

Add either:
- WebSocket
- or SSE

To push:
- Elite state changes
- logs
- map import results
- map / match changes

### Auth

- `Authorization: Bearer <token>`
- reject by default if token is missing or invalid

### Audit

Log:
- timestamp
- action name
- success / failure
- client identifier if available

## Phase 4: API Contract

Define stable payloads for:

- `HealthStatus`
- `EliteState`
- `ServerInfo`
- `SmxSearchResult`
- `ImportResult`
- realtime event envelopes

Define stable errors:

- `401 unauthorized`
- `400 bad request`
- `503 dedicated unavailable`
- `500 internal error`

Document the API in:

- `docs/admin-api.md`

Include:
- endpoint list
- example payloads
- curl examples
- required config

## Phase 5: Companion UI MVP

### Main Shell

- left sidebar
- top status/header
- main content area

### Pages

1. Dashboard
- connection state
- server health
- current title / server info
- recent actions

2. Elite
- current Elite state
- pause / resume actions
- readable round status

3. Maps / SMX
- search box
- result list
- import action
- import feedback

4. Logs
- recent actions
- errors
- imports
- state transitions

5. Settings
- API URL
- API token
- connection preferences

## Phase 6: Electron Bridge

Expose safe preload APIs for:

- `getSettings()`
- `saveSettings()`
- `request(endpoint, options)`
- `subscribeEvents()`

Keep network access and local file access controlled through the Electron boundary rather than giving the renderer unrestricted access.

## Phase 7: UX Direction

The companion should be:

- utilitarian
- readable
- low-friction
- reliable under admin use

It does not need to imitate in-game UI. It should optimize for operational clarity.

Required UX states:

- loading
- connected
- disconnected
- reconnecting
- action success
- action failure

Sensitive actions should use clear confirmation when appropriate.

## Phase 8: Security Defaults

### Safe Defaults

- bind API to `127.0.0.1` by default
- require a strong token
- do not expose dedicated XML-RPC

### Recommended Remote Access

- VPN
- Tailscale
- protected reverse proxy

### Avoid

- exposing raw admin HTTP on the public Internet with weak auth

## Phase 9: Validation

### Local Validation

- app boots
- API reachable
- Elite state loads
- pause / resume works
- SMX search works
- SMX import works

### Dedicated Validation

- dedicated disconnect handling
- reconnect handling
- import errors
- Elite callback updates

### Error Cases

- invalid token
- API offline
- dedicated offline
- map not found

## Phase 10: Packaging

### Development

- `npm run dev`

### Release

- Windows packaging first
- keep Electron build clean and documented

## Recommended Delivery Order

### Lot A

- scaffold `maniacontrol-companion`
- reuse Electron base from `horadric-companion`
- strip D2R-specific logic
- establish minimal shell

### Lot B

- add admin API to `maniacontrol-ts`
- implement:
  - `GET /health`
  - `GET /elite/state`
  - `POST /elite/pause`
  - `POST /elite/resume`

### Lot C

- build Dashboard and Elite pages
- connect companion to the API

### Lot D

- add SMX endpoints
- build Maps / SMX page

### Lot E

- add realtime logs / events
- add settings persistence
- tighten security defaults

### Lot F

- packaging
- documentation
- deployment notes

## Success Criteria

- server administration no longer depends on in-game UI
- pause / resume works from the companion
- SMX search / import works from the companion
- Elite state is visible in near real time
- chat commands remain as fallback only, not primary UX

## First Practical Next Step

Start with:

1. Lot B if the goal is backend-first
2. Lot A if the goal is to stand up the companion shell first

Recommended sequence:

1. implement admin API in `maniacontrol-ts`
2. scaffold `maniacontrol-companion`
3. connect Elite view
4. connect SMX view
5. secure and package
