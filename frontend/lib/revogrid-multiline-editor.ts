import type { ColumnDataSchemaModel, EditCell, EditorBase } from "@revolist/revogrid";

type SaveCallback = (value?: unknown, preventFocus?: boolean) => void;

/**
 * RevoGrid's default text editor renders an input element, which strips line
 * breaks as soon as a multiline value is committed. Keep textarea-backed
 * fields lossless and use Ctrl/Cmd+Enter as the explicit commit shortcut.
 */
export class RevoGridMultilineEditor implements EditorBase {
  element: Element | null = null;
  editCell?: EditCell;
  private textarea: HTMLTextAreaElement | null = null;

  constructor(
    private readonly data: ColumnDataSchemaModel,
    private readonly saveCallback?: SaveCallback
  ) {}

  componentDidRender() {
    requestAnimationFrame(() => this.textarea?.focus());
  }

  beforeDisconnect() {
    this.textarea?.blur();
  }

  getValue() {
    return this.textarea?.value;
  }

  private onKeyDown(event: KeyboardEvent) {
    if (event.isComposing) return;

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.beforeDisconnect();
      this.saveCallback?.(this.getValue(), false);
      return;
    }

    if (event.key === "Tab") {
      event.stopPropagation();
      this.beforeDisconnect();
      this.saveCallback?.(this.getValue(), true);
      return;
    }

    if (event.key === "Enter") event.stopPropagation();
  }

  render(createElement: Parameters<EditorBase["render"]>[0]) {
    return createElement("textarea", {
      class: "bulk-grid-multiline-editor",
      value: this.editCell?.val ?? this.data.value ?? "",
      ref: (element: HTMLTextAreaElement) => {
        this.textarea = element;
      },
      onKeyDown: (event: KeyboardEvent) => this.onKeyDown(event),
    });
  }
}
