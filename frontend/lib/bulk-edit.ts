import type { EntityFieldDefinition } from "~/lib/api/types/data-contracts";

export type BulkEditorKind = "text" | "textarea" | "number" | "date" | "boolean" | "location" | "tags";

export type BulkEditorColumn = {
  key: string;
  label: string;
  kind: BulkEditorKind;
  defaultVisible?: boolean;
  readonly?: boolean;
  maxLength?: number;
  min?: number;
  customField?: EntityFieldDefinition;
};

export const customFieldKey = (field: EntityFieldDefinition) =>
  `field:${encodeURIComponent(field.name)}:${encodeURIComponent(field.type)}`;

export function parseClipboardGrid(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === "\t") {
      row.push(value);
      value = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }

  row.push(value);
  if (row.length > 1 || row[0] !== "" || rows.length === 0) rows.push(row);
  return rows;
}

export function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  return null;
}

export function isDateOnly(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
