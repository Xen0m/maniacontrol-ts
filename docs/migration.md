# Migration Notes

## Legacy reference

The PHP repository remains the functional reference for behavior. The TypeScript rewrite should port features in this order:

1. session boot and callback loop
2. server metadata and player tracking
3. ShootMania callback models
4. one low-risk plugin
5. config and storage migration
6. third-party services

## First plugins worth porting

### 1. Elite state plugin

Source reference:

- `core/Callbacks/ShootManiaCallbacks.php`
- `core/Callbacks/Structures/ShootMania/OnEliteStartTurnStructure.php`
- `core/Callbacks/Structures/ShootMania/OnEliteEndTurnStructure.php`

Why first:

- bounded scope
- specific to ShootMania Elite
- depends on a small set of script callbacks
- validates the TypeScript callback normalization layer early
- gives us a reusable in-memory match state for later commands, widgets, and persistence

### 2. Custom Votes

Why next:

- good test of command handling and permission model
- useful on most servers

### 3. Server Ranking or Local Records

Why later:

- introduces persistence
- needs cleaner callback normalization

## Things not worth porting blindly

- old MyISAM table layout
- implicit config conventions from `configs/server.xml`
- hard coupling to remote services unless they are still needed
- TrackMania-only features in the initial ShootMania-focused milestone

## Proposed milestone definition

### Milestone A

- connect/authenticate
- read server info
- enable callbacks
- log callback traffic
- keep an in-memory Elite match state for `SMStormElite@nadeolabs`

### Milestone B

- player state cache
- command routing
- custom votes
- SQLite persistence

### Milestone C

- plugin package loading
- web or CLI admin surface
- optional external integrations
