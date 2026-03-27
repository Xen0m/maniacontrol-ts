import { label, manialink, renderManialink } from "../../../ui/manialink.js";
import { MANIACONTROL_STYLES, WINDOW_DEFAULTS } from "../../../ui/maniacontrol-style.js";
import { buildStatusWindow } from "../../../ui/window-manager.js";
import type { EliteStateSnapshot } from "./state.js";

const ELITE_WIDGET_ID = "maniacontrol-ts.elite.state";

export { ELITE_WIDGET_ID };

export function renderEliteStateWidget(state: EliteStateSnapshot): string {
  const currentTurn = state.currentTurn;
  const scoreText = `${state.stats.attackerWins} - ${state.stats.defenderWins}`;
  const summaryRows = [
    { label: "Pause", value: stripColorCodes(formatPauseState(state.paused, state.pauseSupported)) },
    { label: "Turn", value: String(currentTurn?.number ?? state.turnNumber) },
    { label: "Score", value: scoreText }
  ];

  return renderManialink(
    manialink(ELITE_WIDGET_ID, [
      buildStatusWindow(
        "Elite",
        [
          ...summaryRows.flatMap((row, index) => {
            const rowY = -3.3 - index * 2.1;
            return [
              label({
                posn: `-29 ${rowY} 2`,
                sizen: "8 2",
                halign: "left",
                textcolor: MANIACONTROL_STYLES.secondaryTextColor,
                textsize: "0.72",
                textemboss: "1",
                text: row.label
              }),
              label({
                posn: `-20 ${rowY} 2`,
                sizen: "16 2",
                halign: "left",
                textcolor: MANIACONTROL_STYLES.primaryTextColor,
                textsize: "0.76",
                textemboss: "1",
                text: row.value
              })
            ];
          })
        ],
        {
          posn: WINDOW_DEFAULTS.status.posn,
          size: WINDOW_DEFAULTS.status.size
        }
      )
    ])
  );
}

function stripColorCodes(value: string): string {
  return value.replaceAll(/\$[0-9a-fk-orzs]/gi, "");
}

function formatPauseState(paused: boolean | null, supported: boolean): string {
  if (!supported) {
    return "$888unsupported";
  }
  if (paused === true) {
    return "$f80paused";
  }
  if (paused === false) {
    return "$0f0running";
  }
  return "$ff0unknown";
}
