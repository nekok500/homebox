import { describe, expect, it } from "vitest";

import { isDateOnly, parseBoolean, parseClipboardGrid } from "./bulk-edit";

describe("parseClipboardGrid", () => {
  it("parses spreadsheet rows and removes a trailing empty row", () => {
    expect(parseClipboardGrid("one\ttwo\r\nthree\tfour\r\n")).toEqual([
      ["one", "two"],
      ["three", "four"],
    ]);
  });

  it("keeps tabs, newlines, and escaped quotes inside quoted cells", () => {
    expect(parseClipboardGrid('"one\ttwo"\t"line 1\nline ""2"""')).toEqual([["one\ttwo", 'line 1\nline "2"']]);
  });
});

describe("parseBoolean", () => {
  it.each([
    ["true", true],
    ["YES", true],
    ["0", false],
    ["off", false],
    ["maybe", null],
  ])("parses %s", (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });
});

describe("isDateOnly", () => {
  it("accepts empty and valid calendar dates", () => {
    expect(isDateOnly("")).toBe(true);
    expect(isDateOnly("2024-02-29")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isDateOnly("2024-2-29")).toBe(false);
    expect(isDateOnly("2025-02-29")).toBe(false);
  });
});
