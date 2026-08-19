import { describe, expect, it } from "vitest";

import {
  combineClipboardGridParts,
  formatBulkEditTag,
  isDateOnly,
  parseBoolean,
  parseClipboardGrid,
  resolveBulkEditLocation,
  resolveBulkEditTagIds,
  serializeClipboardGrid,
  serializeClipboardGridHtml,
} from "./bulk-edit";

describe("bulk edit tags", () => {
  const tags = [
    { id: "11111111-1111-1111-1111-111111111111", name: "Home" },
    { id: "22222222-2222-2222-2222-222222222222", name: "Office" },
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Storage",
      parentId: "11111111-1111-1111-1111-111111111111",
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Storage",
      parentId: "22222222-2222-2222-2222-222222222222",
    },
    { id: "55555555-5555-5555-5555-555555555555", name: "Unique" },
  ];

  it("formats and resolves equal names by their hierarchy path", () => {
    expect(formatBulkEditTag(tags[2]!, tags)).toBe("Home / Storage");
    expect(formatBulkEditTag(tags[3]!, tags)).toBe("Office / Storage");
    expect(resolveBulkEditTagIds("Home / Storage; Office / Storage", tags)).toEqual([tags[2]!.id, tags[3]!.id]);
  });

  it("keeps unique leaf names as a backwards-compatible input", () => {
    expect(resolveBulkEditTagIds("unique", tags)).toEqual([tags[4]!.id]);
    expect(resolveBulkEditTagIds("Storage", tags)).toBeUndefined();
  });

  it("adds an ID when even the complete path is duplicated", () => {
    const duplicate = { ...tags[2]!, id: "66666666-6666-6666-6666-666666666666" };
    const duplicates = [...tags, duplicate];
    const formatted = formatBulkEditTag(tags[2]!, duplicates);

    expect(formatted).toBe(`Home / Storage [id:${tags[2]!.id}]`);
    expect(resolveBulkEditTagIds(formatted, duplicates)).toEqual([tags[2]!.id]);
  });
});

describe("resolveBulkEditLocation", () => {
  const locations = [
    { id: "attic", name: "Storage", treeString: "House > Storage" },
    { id: "garage", name: "Storage", treeString: "Garage > Storage" },
    { id: "office", name: "Office", treeString: "House > Office" },
  ];

  it("treats an empty value as an unplaced item", () => {
    expect(resolveBulkEditLocation("  ", locations)).toBeNull();
  });

  it("resolves unique paths and names while rejecting ambiguous names", () => {
    expect(resolveBulkEditLocation("House / Storage", locations)?.id).toBe("attic");
    expect(resolveBulkEditLocation("office", locations)?.id).toBe("office");
    expect(resolveBulkEditLocation("Storage", locations)).toBeUndefined();
  });
});

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
