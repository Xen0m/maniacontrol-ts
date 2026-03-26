# Admin API

Private HTTP API intended for `maniacontrol-companion`.

## Config

`admin` supports:

- `enabled`
- `host`
- `port`
- `token`
- `principals`
- `auditPath`
- `activityPath`
- `chatLoggingEnabled`

When `chatLoggingEnabled` is `true`, successful write actions are also announced in the dedicated server chat.

`token` keeps the current full-access behavior. `principals` can be used to define multiple bearer tokens with roles/scopes.

Supported built-in roles:

- `owner`
- `operator`
- `observer`

Typical scopes:

- `read`
- `audit.read`
- `players.write`
- `players.sanctions.read`
- `players.sanctions.write`
- `maps.write`
- `elite.write`
- `chat.write`
- `mode.write`
- `mx.write`

## Auth

All endpoints require:

```http
Authorization: Bearer <token>
```

## Endpoints

### `GET /health`

Returns process and dedicated-session health summary.

Also includes the resolved admin identity for the current bearer token:

- `auth.id`
- `auth.label`
- `auth.role`
- `auth.scopes`

### `GET /server/info`

Returns startup snapshot plus current dedicated status and game mode.

### `GET /server/mode-script-info`

Returns the current mode script metadata and available command descriptors.

### `GET /server/mode-script-settings`

Returns the current mode script settings payload as reported by the dedicated server.

### `GET /server/players`

Returns the current connected players with enriched detailed info when available.

### `GET /server/players/banlist?limit=100&offset=0`

Returns the current server ban list.

### `GET /server/players/blacklist?limit=100&offset=0`

Returns the current server blacklist.

### `GET /server/maps/current`

Returns the current map info from the dedicated server.

### `GET /server/maps/next`

Returns the currently scheduled next map when available.

### `GET /server/maps?limit=50&offset=0`

Returns a slice of the server map list.

### `POST /server/maps/choose-next`

Example body:

```json
{
  "fileName": "MatchSettings\\My Maps\\example.Map.Gbx"
}
```

### `POST /server/mode-script-settings`

```json
{
  "S_TimeLimit": 60000,
  "S_ScoreLimit": 9
}
```

or

```json
{
  "settings": {
    "S_TimeLimit": 60000,
    "S_ScoreLimit": 9
  }
}
```

### `POST /server/mode-script-commands`

```json
{
  "Command_SetPause": true
}
```

or

```json
{
  "commands": {
    "Command_SetPause": true
  }
}
```

### `POST /server/maps/jump`

Example body:

```json
{
  "uId": "L7Lz2OMZh6FVqLPfeoQceh_8Ihb"
}
```

### `POST /server/maps/restart`

Restarts the current map immediately.

### `POST /server/maps/next`

Advances immediately to the next scheduled map.

### `GET /elite/state`

Returns the current ShootMania Elite state snapshot when the plugin is enabled.

### `POST /elite/pause`

Pauses the match when the current mode supports it.

### `POST /elite/resume`

Resumes the match.

### `GET /mx/search?q=elite`

Searches ShootMania Exchange using the plugin settings.

### `POST /mx/import`

Example body:

```json
{
  "mapId": 123
}
```

### `GET /events`

SSE stream for companion realtime updates.

### `GET /admin/audit?limit=100`

Returns recent persisted admin actions from the audit log.

### `GET /admin/activity?limit=100&category=players&login=example`

Returns recent persisted domain activity entries.

## Authorization model

- read endpoints require `read`
- audit trail requires `audit.read`
- player actions require `players.write`
- sanction list access requires `players.sanctions.read`
- ban/blacklist actions require `players.sanctions.write`
- map actions require `maps.write`
- Elite controls require `elite.write`
- chat actions require `chat.write`
- mode script edits require `mode.write`
- SMX imports require `mx.write`

Missing scope returns:

```json
{
  "error": "forbidden",
  "role": "observer",
  "requiredScope": "players.write"
}
```

### `POST /server/players/kick`

```json
{
  "login": "player_login",
  "message": "Kicked from companion"
}
```

### `POST /server/players/force-team`

```json
{
  "login": "player_login",
  "team": 0
}
```

### `POST /server/players/force-spectator`

```json
{
  "login": "player_login",
  "mode": 1
}
```

### `POST /server/players/ban`

```json
{
  "login": "player_login",
  "message": "Manual admin ban",
  "addToBlacklist": false
}
```

### `POST /server/players/unban`

```json
{
  "login": "player_login"
}
```

### `POST /server/players/blacklist`

```json
{
  "login": "player_login"
}
```

### `POST /server/players/unblacklist`

```json
{
  "login": "player_login"
}
```

### `POST /server/chat/message`

```json
{
  "message": "Server restart in 2 minutes"
}
```

### `POST /server/chat/notice`

```json
{
  "message": "Warmup is live",
  "variant": 2
}
```

Current event types:

- `system.connected`
- `elite.stateChanged`
- `elite.pause`
- `elite.resume`
- `mx.import`
- `server.beginMap`
- `server.endMap`
- `server.nextMapChanged`
- `server.mapJumped`
- `server.mapRestarted`
- `server.nextMapTriggered`
- `server.modeScriptSettingsChanged`
- `server.modeScriptCommandsSent`
- `server.playerConnect`
- `server.playerDisconnect`
- `server.playerKicked`
- `server.playerTeamForced`
- `server.playerSpectatorForced`
- `server.playerBanned`
- `server.playerUnbanned`
- `server.playerBlacklisted`
- `server.playerUnblacklisted`
- `server.chatMessageSent`
- `server.noticeSent`
