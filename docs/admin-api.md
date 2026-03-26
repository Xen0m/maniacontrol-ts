# Admin API

Private HTTP API intended for `maniacontrol-companion`.

## Auth

All endpoints require:

```http
Authorization: Bearer <token>
```

## Endpoints

### `GET /health`

Returns process and dedicated-session health summary.

### `GET /server/info`

Returns startup snapshot plus current dedicated status and game mode.

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

### `POST /server/maps/jump`

Example body:

```json
{
  "uId": "L7Lz2OMZh6FVqLPfeoQceh_8Ihb"
}
```

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
