# UI Framework

`maniacontrol-ts` now uses a small shared UI layer inspired by ManiaControl's structure instead of plugin-local ad-hoc layouts.

## Modules

- `src/ui/maniacontrol-style.ts`
  Centralizes default styles, sidebar placement, window sizes, and shared colors.

- `src/ui/sidebar-menu-manager.ts`
  Provides ordered sidebar entries and computes ShootMania-safe positions.

- `src/ui/window-manager.ts`
  Provides the shared main window shell and status window shell.

- `src/ui/list-helpers.ts`
  Provides the default search section and list row builders used by interactive panels.

- `src/ui/ui-service.ts`
  Sends manialinks and chat feedback to the dedicated server and logs widget dispatches.

## Current plugin usage

- `maniaexchange`
  Uses the sidebar manager, main window helper, and list/search helpers.

- `shootmania-elite`
  Uses the shared status window helper for a compact state widget.

## Chat command fallback

The current UI is complemented by chat commands so common actions do not depend on mouse cursor mode.

### ManiaExchange

- `/mx open`
- `/mx search <query>`
- `/mx add <mapId>`

### Elite

- `/elite pause`
- `/elite resume`

## Runtime validation checklist

1. Connect a player after the controller starts.
2. Confirm the sidebar entry is rendered.
3. Open the `SMX` panel.
4. Run `/mx search elite`.
5. Run `/mx add <mapId>`.
6. Run `/elite pause` and `/elite resume`.
7. Check controller logs for `Dispatching widget`.

## Notes

- Widget dispatch logging is emitted through the `ui-service` logger at debug level.
- The old compatibility layer was removed once plugins were migrated to the shared UI modules.
