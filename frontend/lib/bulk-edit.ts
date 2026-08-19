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

type BulkEditLocation = {
  name: string;
  treeString: string;
};

export function resolveBulkEditLocation<T extends BulkEditLocation>(
  value: string,
  locations: readonly T[]
): T | null | undefined {
  const normalized = value.trim().replaceAll(" > ", " / ");
  if (normalized === "") return null;

  const byPath = locations.filter(location => location.treeString.replaceAll(" > ", " / ") === normalized);
  if (byPath.length === 1) return byPath[0];

  const byName = locations.filter(location => location.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  return byName.length === 1 ? byName[0] : undefined;
}

export type BulkEditTag = {
  id: string;
  name: string;
  parentId?: string | null;
};

const normalizeTagReference = (value: string) => value.trim().replaceAll(" > ", " / ").toLocaleLowerCase();

const bulkEditTagPath = (tag: BulkEditTag, tags: readonly BulkEditTag[]) => {
  const tagsById = new Map(tags.map(candidate => [candidate.id, candidate]));
  const names = [tag.name];
  const visited = new Set([tag.id]);
  let parentId = tag.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = tagsById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return names.join(" / ");
};

export function formatBulkEditTag(tag: BulkEditTag, tags: readonly BulkEditTag[]): string {
  const storedTag = tags.find(candidate => candidate.id === tag.id);
  const path = bulkEditTagPath(storedTag ?? tag, tags);
  const matchingPaths = tags.filter(
    candidate => normalizeTagReference(bulkEditTagPath(candidate, tags)) === normalizeTagReference(path)
  );

  return !storedTag || matchingPaths.length !== 1 ? `${path} [id:${tag.id}]` : path;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveBulkEditTagIds(value: string, tags: readonly BulkEditTag[]): string[] | undefined {
  const references = value
    .split(";")
    .map(reference => reference.trim())
    .filter(Boolean);
  const resolved: string[] = [];

  for (const reference of references) {
    const explicitId = reference.match(/\[id:([^\]]+)]\s*$/i)?.[1]?.trim();
    const knownByExplicitId = explicitId
      ? tags.find(tag => tag.id.toLocaleLowerCase() === explicitId.toLocaleLowerCase())
      : undefined;
    let id = knownByExplicitId?.id;
    if (!id && explicitId && uuidPattern.test(explicitId)) id = explicitId;

    if (!id) {
      const knownByRawId = tags.find(tag => tag.id.toLocaleLowerCase() === reference.toLocaleLowerCase());
      if (knownByRawId) id = knownByRawId.id;
    }

    if (!id) {
      const normalized = normalizeTagReference(reference);
      const byPath = tags.filter(tag => normalizeTagReference(bulkEditTagPath(tag, tags)) === normalized);
      if (byPath.length === 1) id = byPath[0]!.id;
    }

    if (!id) {
      const byName = tags.filter(tag => tag.name.toLocaleLowerCase() === reference.toLocaleLowerCase());
      if (byName.length === 1) id = byName[0]!.id;
    }

    if (!id) return undefined;
    if (!resolved.includes(id)) resolved.push(id);
  }

  return resolved;
}

export type ClipboardCell = string | number | boolean | null | undefined;

const clipboardCellText = (value: ClipboardCell) => String(value ?? "").replace(/\r\n?/g, "\n");

export function serializeClipboardGrid(rows: ClipboardCell[][]): string {
  return rows
    .map(row =>
      row
        .map(value => {
          const text = clipboardCellText(value);
          return /["\t\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join("\t")
    )
    .join("\r\n");
}

const escapeClipboardHtml = (value: ClipboardCell) =>
  clipboardCellText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");

export function serializeClipboardGridHtml(rows: ClipboardCell[][]): string {
  const body = rows
    .map(
      row =>
        `<tr>${row.map(value => `<td style="white-space: pre-wrap">${escapeClipboardHtml(value)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

export function combineClipboardGridParts(parts: ClipboardCell[][][]): ClipboardCell[][] {
  const rowCount = Math.max(0, ...parts.map(rows => rows.length));
  return Array.from({ length: rowCount }, (_, rowIndex) => parts.flatMap(rows => rows[rowIndex] ?? []));
}

const clipboardHtmlNodeText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeName === "BR") return "\n";

  const text = Array.from(node.childNodes).map(clipboardHtmlNodeText).join("");
  return ["DIV", "LI", "P"].includes(node.nodeName) && text && !text.endsWith("\n") ? `${text}\n` : text;
};

export function parseClipboardHtmlGrid(input: string): string[][] | null {
  const fragment = document.createRange().createContextualFragment(input);
  const table = fragment.querySelector("table");
  if (!table) return null;

  return Array.from(table.rows).map(row =>
    Array.from(row.cells).map(cell =>
      Array.from(cell.childNodes).map(clipboardHtmlNodeText).join("").replace(/\n$/, "").replace(/\r\n?/g, "\n")
    )
  );
}

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
      } else if (quoted) {
        quoted = false;
      } else if (value === "") {
        quoted = true;
      } else {
        value += char;
      }
      continue;
    }
    if (quoted && char === "\r") {
      if (input[i + 1] === "\n") i++;
      value += "\n";
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
