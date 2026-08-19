import { describe, expect, it } from "vitest";

import {
  combineClipboardGridParts,
  isDateOnly,
  parseBoolean,
  parseClipboardGrid,
  serializeClipboardGrid,
  serializeClipboardGridHtml,
} from "./bulk-edit";

describe("combineClipboardGridParts", () => {
  it("combines pinned and regular grid dimensions by row", () => {
    expect(
      combineClipboardGridParts([
        [["000-001"], ["000-002"]],
        [
          ["Item 1", 10],
          ["Item 2", 20],
        ],
      ])
    ).toEqual([
      ["000-001", "Item 1", 10],
      ["000-002", "Item 2", 20],
    ]);
  });
});

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

  it("keeps literal quotes that do not delimit a cell", () => {
    expect(parseClipboardGrid('10" screen\tplain')).toEqual([['10" screen', "plain"]]);
  });

  it("normalizes Windows line endings inside quoted cells", () => {
    expect(parseClipboardGrid('"line 1\r\nline 2"\tvalue')).toEqual([["line 1\nline 2", "value"]]);
  });
});

describe("serializeClipboardGrid", () => {
  it("creates Excel-compatible TSV and round-trips multiline cells", () => {
    const rows = [["plain", "line 1\nline 2", "tab\tinside", 'a "quote"', 12, true, null]];
    const serialized = serializeClipboardGrid(rows);

    expect(serialized).toBe('plain\t"line 1\nline 2"\t"tab\tinside"\t"a ""quote"""\t12\ttrue\t');
    expect(parseClipboardGrid(serialized)).toEqual([
      ["plain", "line 1\nline 2", "tab\tinside", 'a "quote"', "12", "true", ""],
    ]);
  });

  it("uses CRLF between spreadsheet rows", () => {
    expect(serializeClipboardGrid([["one"], ["two"]])).toBe("one\r\ntwo");
  });
});

describe("serializeClipboardGridHtml", () => {
  it("creates an HTML table with escaped values and line breaks", () => {
    expect(serializeClipboardGridHtml([["<b>one</b>", 'a & "b"', "line 1\nline 2"]])).toBe(
      '<table><tbody><tr><td style="white-space: pre-wrap">&lt;b&gt;one&lt;/b&gt;</td><td style="white-space: pre-wrap">a &amp; &quot;b&quot;</td><td style="white-space: pre-wrap">line 1<br>line 2</td></tr></tbody></table>'
    );
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
