import { describe, expect, it } from "vitest";

import {
  createManiaExchangeSettings,
  createPlayerMxState,
  DEFAULT_MANIA_EXCHANGE_SETTINGS
} from "./state.js";

describe("maniaexchange state helpers", () => {
  it("creates sane default settings", () => {
    expect(createManiaExchangeSettings(undefined)).toEqual(DEFAULT_MANIA_EXCHANGE_SETTINGS);
  });

  it("normalizes configured settings", () => {
    expect(createManiaExchangeSettings({
      mapsDirectory: "/srv/maps",
      targetRelativeDirectory: "SMX",
      importOnStartIds: [1, 2, "3", null],
      insertMode: "insert",
      announceImports: false,
      showWidget: true,
      searchLimit: 9.9,
      defaultQuery: "  elite promo  "
    })).toEqual({
      mapsDirectory: "/srv/maps",
      targetRelativeDirectory: "SMX",
      importOnStartIds: [1, 2],
      insertMode: "insert",
      announceImports: false,
      showWidget: true,
      searchLimit: 9,
      defaultQuery: "elite promo"
    });
  });

  it("creates default player panel state", () => {
    expect(createPlayerMxState("elite")).toEqual({
      query: "elite",
      results: [],
      busy: false,
      panelOpen: false
    });
  });
});
