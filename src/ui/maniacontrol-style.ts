export interface SidebarPosition {
  x: number;
  y: number;
  z: number;
}

export interface WindowGeometry {
  posn: string;
  size: string;
}

export const MANIACONTROL_STYLES = {
  backgroundStyle: "Bgs1InRace",
  backgroundSubstyle: "BgTitleShadow",
  cardSubstyle: "BgCard1",
  alternateCardSubstyle: "BgCard",
  titleTextStyle: "TextTitle1",
  inputTextStyle: "TextValueSmall",
  accentColor: "08bf",
  closeColor: "a22d",
  mutedTextColor: "aaa",
  secondaryTextColor: "ddd",
  primaryTextColor: "fff",
  accentTextColor: "7fd"
} as const;

export const SIDEBAR_DEFAULTS = {
  shootmania: {
    x: 146,
    y: -24,
    z: 5
  },
  trackmania: {
    x: 156,
    y: 17,
    z: 5
  },
  itemSize: 8,
  itemMarginFactor: 1.2
} as const;

export const WINDOW_DEFAULTS = {
  main: {
    posn: "0 35 20",
    size: "120 42"
  },
  status: {
    posn: "132 76 5",
    size: "48 12.5"
  }
} as const satisfies Record<string, WindowGeometry>;

export function getSidebarPosition(order: number, mode: "shootmania" | "trackmania" = "shootmania"): SidebarPosition {
  const base = SIDEBAR_DEFAULTS[mode];
  const spacing = SIDEBAR_DEFAULTS.itemSize * SIDEBAR_DEFAULTS.itemMarginFactor;
  return {
    x: base.x,
    y: base.y - order * spacing,
    z: base.z
  };
}
