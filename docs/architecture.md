# Architecture

## Intent

The rewrite keeps the official dedicated-server control model:

- one long-lived GBXRemote TCP connection to the XML-RPC port
- dedicated-server callbacks received over the same transport
- optional script callback integration through `TriggerModeScriptEventArray`
- controller-side plugins for policy, storage, admin commands, and external integrations

## Layers

### Transport

`src/transport/gbx-remote.ts`

- owns the TCP socket
- validates the `GBXRemote 2` handshake
- reads and writes framed XML-RPC messages
- matches responses to request handles
- buffers dedicated-server callbacks

### XML-RPC

`src/xmlrpc/codec.ts`

- encodes method calls
- decodes responses, faults, and callback invocations
- stays separate from transport so it can be tested independently

### Dedicated API

`src/transport/dedicated-client.ts`

- wraps raw method names
- exposes higher-level controller operations
- is the correct place for compatibility fallbacks by API version later

### Core runtime

`src/core/controller.ts`

- creates the session
- sets the API version
- enables callbacks
- dispatches callback frames into an event bus
- owns plugin lifecycle

### Plugins

`src/plugins`

- built-ins are local first
- external plugins should later be loaded from ESM modules
- plugin contracts should be stable even if the transport changes internally

### UI

`src/ui`

- deliberately avoids porting the old PHP/FML stack as-is
- provides a small TypeScript builder for chat and simple manialink widgets
- is intended as a reinterpretation of ManiaControl's visible in-game surface, not a line-by-line clone

## Planned additions

- persistence layer and migrations
- callback payload parsers for ManiaPlanet, ShootMania, and TrackMania
- per-title capability matrix
- proper state stores for players, maps, and matches
- plugin package loading from disk
- admin HTTP API or CLI
- integration tests against a real dedicated server
- separate stats web surface and read-model API

See also:

- `docs/stats-web-architecture.md`
