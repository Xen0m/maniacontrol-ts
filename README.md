# ManiaControl TS

Reimplementation in TypeScript of a ManiaPlanet dedicated server controller, with a focus on ShootMania.

## Why a rewrite

The legacy PHP project is still useful as a reference, but it mixes several concerns:

- GBXRemote transport
- XML-RPC codec
- callback dispatch
- game-mode abstractions
- plugin lifecycle
- persistence and third-party integrations

This repository starts by separating those layers and targeting a modern Node.js runtime.

## Scope of this first scaffold

This is not a drop-in replacement yet. It includes:

- a typed configuration loader
- a GBXRemote transport skeleton over TCP
- XML-RPC encode/decode helpers
- a controller runtime
- a plugin API
- one built-in example plugin
- one built-in ShootMania Elite state plugin
- one built-in ManiaExchange import plugin
- a lightweight TypeScript-only in-game UI layer for chat and manialink widgets
- a shared ManiaControl-like UI foundation for sidebar entries, windows, and list/search panels
- architecture and migration notes

## Local development

1. Copy `maniacontrol.example.json` to `maniacontrol.local.json`
2. Fill in your dedicated server XML-RPC credentials
3. Install dependencies
4. Run `npm run dev`

## ManiaExchange import

The project now includes a first SMX integration layer:

- `npm run mx:search -- <query> --config maniacontrol.local.json`
- `npm run mx:import -- <mapId> --maps-dir "/abs/path/to/server/UserData/Maps/My Maps/SMX" --target-dir "My Maps\\SMX" --config maniacontrol.local.json`

There is also a built-in `maniaexchange` plugin that can import configured map IDs on startup.

## Deployment tool

The repository now includes a first multi-instance deployment helper:

- `npm run deploy:list`
- `npm run deploy:create -- <id> --server-port 5000 --admin-port 3001 --server-password change-me`
- `npm run deploy:show -- <id>`
- `npm run deploy:status -- [id]`

By default it writes:

- a manifest in `./deployments/instances.json`
- one config per instance in `./deployments/<id>/maniacontrol.local.json`
- one data directory per instance in `./deployments/<id>/data`
- one launcher script in `./deployments/<id>/run-instance.sh`
- one unit file in `./deployments/systemd/maniacontrol-ts-<id>.service`

This is intended for setups where you run one `maniacontrol-ts` instance per dedicated server, for example `lobby`, `elite`, or `joust`.

For a VM using `systemd`, the generated unit file can be installed with a flow like:

1. `sudo cp deployments/systemd/maniacontrol-ts-elite.service /etc/systemd/system/`
2. `sudo systemctl daemon-reload`
3. `sudo systemctl enable --now maniacontrol-ts-elite.service`

`deploy:status` reports generated files for each instance and also probes `systemctl` when available.

## Chat commands

The controller now exposes a first chat-command fallback for common actions:

- `/mx open`
- `/mx search <query>`
- `/mx add <mapId>`
- `/elite pause`
- `/elite resume`

See [docs/ui-framework.md](./docs/ui-framework.md) for the shared UI architecture and validation checklist.

## Initial target architecture

- `src/transport`: TCP and GBXRemote framing
- `src/xmlrpc`: XML-RPC encode/decode
- `src/core`: controller runtime and callback bus
- `src/plugins`: plugin contracts and built-ins
- `src/config`: config loading and validation
- `docs`: migration and architecture notes
