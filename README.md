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
- a lightweight TypeScript-only in-game UI layer for chat and manialink widgets
- architecture and migration notes

## Local development

1. Copy `maniacontrol.example.json` to `maniacontrol.local.json`
2. Fill in your dedicated server XML-RPC credentials
3. Install dependencies
4. Run `npm run dev`

## Initial target architecture

- `src/transport`: TCP and GBXRemote framing
- `src/xmlrpc`: XML-RPC encode/decode
- `src/core`: controller runtime and callback bus
- `src/plugins`: plugin contracts and built-ins
- `src/config`: config loading and validation
- `docs`: migration and architecture notes
