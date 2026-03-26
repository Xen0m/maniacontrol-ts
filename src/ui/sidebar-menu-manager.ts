import { frame, label, quad } from "./manialink.js";
import { getSidebarPosition, MANIACONTROL_STYLES, SIDEBAR_DEFAULTS } from "./maniacontrol-style.js";

type SidebarNode = ReturnType<typeof frame> | ReturnType<typeof label> | ReturnType<typeof quad>;

export interface SidebarEntry {
  id: string;
  order: number;
  text: string;
  action: string;
}

export class SidebarMenuManager {
  private readonly entries = new Map<string, SidebarEntry>();

  public addEntry(entry: SidebarEntry): void {
    this.entries.set(entry.id, entry);
  }

  public removeEntry(id: string): void {
    this.entries.delete(id);
  }

  public getEntries(): SidebarEntry[] {
    return [...this.entries.values()].sort((left, right) => left.order - right.order);
  }

  public getEntryPosition(id: string, mode: "shootmania" | "trackmania" = "shootmania"): string | undefined {
    const entries = this.getEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }

    const position = getSidebarPosition(index, mode);
    return `${position.x} ${position.y} ${position.z}`;
  }

  public renderEntry(id: string, mode: "shootmania" | "trackmania" = "shootmania"): ReturnType<typeof frame> | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    const orderedEntries = this.getEntries();
    const index = orderedEntries.findIndex((item) => item.id === id);
    const position = getSidebarPosition(index, mode);
    return frame(
      {
        posn: `${position.x} ${position.y} ${position.z}`
      },
      buildSidebarButtonContent(entry.text, entry.action)
    );
  }
}

export function buildSidebarButtonContent(text: string, action: string): SidebarNode[] {
  const size = SIDEBAR_DEFAULTS.itemSize;
  return [
    quad({
      sizen: `${size} ${size}`,
      style: MANIACONTROL_STYLES.backgroundStyle,
      substyle: MANIACONTROL_STYLES.backgroundSubstyle,
      action
    }),
    label({
      posn: "0 -0.7 2",
      sizen: `${size - 1} 4`,
      style: MANIACONTROL_STYLES.titleTextStyle,
      textcolor: MANIACONTROL_STYLES.primaryTextColor,
      text,
      textsize: "1.2",
      textemboss: "1",
      action
    }),
    quad({
      posn: `0 ${-(size / 2) - 0.9} 1`,
      sizen: `${size} 0.8`,
      bgcolor: MANIACONTROL_STYLES.accentColor
    })
  ];
}
