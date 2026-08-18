<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import Grid from "@revolist/vue3-datagrid";
  import type { AfterEditEvent, ColumnRegular } from "@revolist/revogrid";
  import { toast } from "@/components/ui/sonner";
  import MdiContentSave from "~icons/mdi/content-save";
  import MdiLoading from "~icons/mdi/loading";
  import MdiMagnify from "~icons/mdi/magnify";
  import MdiTableCog from "~icons/mdi/table-cog";
  import MdiUndo from "~icons/mdi/undo";
  import MdiArrowUp from "~icons/mdi/arrow-up";
  import MdiArrowDown from "~icons/mdi/arrow-down";
  import BaseContainer from "~/components/Base/Container.vue";
  import SearchFilter from "~/components/Search/Filter.vue";
  import { Button } from "~/components/ui/button";
  import { Checkbox } from "~/components/ui/checkbox";
  import { Input } from "~/components/ui/input";
  import { Label } from "~/components/ui/label";
  import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
  import {
    Pagination,
    PaginationEllipsis,
    PaginationFirst,
    PaginationLast,
    PaginationList,
    PaginationListItem,
  } from "~/components/ui/pagination";
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
  import { Switch } from "~/components/ui/switch";
  import { customFieldKey, isDateOnly, parseBoolean } from "~/lib/bulk-edit";
  import type { BulkEditorColumn } from "~/lib/bulk-edit";
  import { RevoGridMultilineEditor } from "~/lib/revogrid-multiline-editor";
  import type { EntityFieldData, EntityFieldDefinition, EntityOut, EntityPatch } from "~/lib/api/types/data-contracts";

  definePageMeta({ middleware: ["auth"] });

  const { t } = useI18n();
  useHead({ title: `HomeBox | ${t("bulk_edit.title")}` });

  type CellValue = string | number | boolean;
  type EditorRow = EntityOut &
    Record<string, unknown> & {
      locationText: string;
      tagsText: string;
      customValues: Record<string, CellValue>;
      originalValues: Record<string, CellValue>;
      errors: Record<string, string>;
      saveError: string;
    };

  const api = useUserApi();
  const route = useRoute();
  const router = useRouter();
  const tagStore = useTagStore();
  const locationStore = useLocationStore();
  const flatLocations = useFlatLocations();

  const loading = ref(false);
  const saving = ref(false);
  const rows = ref<EditorRow[]>([]);
  const gridSource = shallowRef<EditorRow[]>([]);
  const fieldDefinitions = ref<EntityFieldDefinition[]>([]);
  const total = ref(0);

  const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  const asArray = (value: unknown) => (Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);
  const asNumber = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const query = ref(asString(route.query.q));
  const tagIds = ref(asArray(route.query.tag));
  const locationIds = ref(asArray(route.query.loc));
  const includeArchived = ref(asString(route.query.archived) === "true");
  const orderBy = ref(asString(route.query.orderBy, "name"));
  const page = ref(asNumber(route.query.page, 1));
  const pageSize = useLocalStorage("homebox/bulk-editor-page-size", asNumber(route.query.pageSize, 48));

  const selectedTags = computed({
    get: () => tagStore.tags.filter(tag => tagIds.value.includes(tag.id)),
    set: value => (tagIds.value = value.map(tag => tag.id)),
  });
  const selectedLocations = computed({
    get: () => flatLocations.value.filter(location => locationIds.value.includes(location.id)),
    set: value => (locationIds.value = value.map(location => location.id)),
  });

  const builtInColumns: BulkEditorColumn[] = [
    { key: "assetId", label: "items.asset_id", kind: "text", readonly: true, defaultVisible: true },
    { key: "name", label: "items.name", kind: "text", maxLength: 255, defaultVisible: true },
    { key: "purchasePrice", label: "items.purchase_price", kind: "number", defaultVisible: true },
    { key: "locationText", label: "global.location", kind: "location", defaultVisible: true },
    { key: "purchaseDate", label: "items.purchase_date", kind: "date", defaultVisible: true },
    { key: "description", label: "items.description", kind: "textarea", maxLength: 1000, defaultVisible: true },
    { key: "modelNumber", label: "items.model_number", kind: "text", maxLength: 255, defaultVisible: true },
    { key: "tagsText", label: "global.tags", kind: "tags", defaultVisible: true },
    { key: "quantity", label: "items.quantity", kind: "number", min: 0, defaultVisible: true },
    { key: "notes", label: "items.notes", kind: "textarea", maxLength: 1000, defaultVisible: true },
    { key: "purchaseFrom", label: "items.purchased_from", kind: "text", maxLength: 255, defaultVisible: true },
    { key: "serialNumber", label: "items.serial_number", kind: "text", maxLength: 255 },
    { key: "manufacturer", label: "items.manufacturer", kind: "text", maxLength: 255 },
    { key: "insured", label: "items.insured", kind: "boolean" },
    { key: "archived", label: "items.archived", kind: "boolean" },
    { key: "lifetimeWarranty", label: "items.lifetime_warranty", kind: "boolean" },
    { key: "warrantyExpires", label: "items.warranty_expires", kind: "date" },
    { key: "warrantyDetails", label: "items.warranty_details", kind: "textarea", maxLength: 1000 },
    { key: "soldTo", label: "items.sold_to", kind: "text", maxLength: 255 },
    { key: "soldPrice", label: "items.sold_price", kind: "number" },
    { key: "soldDate", label: "items.sold_at", kind: "date" },
    { key: "soldNotes", label: "items.sold_notes", kind: "textarea", maxLength: 1000 },
  ];

  const customColumns = computed<BulkEditorColumn[]>(() =>
    fieldDefinitions.value.map(field => ({
      key: customFieldKey(field),
      label: field.name,
      kind:
        field.type === "number"
          ? "number"
          : field.type === "boolean"
            ? "boolean"
            : field.type === "time"
              ? "date"
              : "text",
      maxLength: field.type === "text" ? 500 : undefined,
      customField: field,
    }))
  );
  const allColumns = computed(() => [...builtInColumns, ...customColumns.value]);
  const defaultVisible = builtInColumns.filter(column => column.defaultVisible).map(column => column.key);
  const visibleKeys = useLocalStorage<string[]>("homebox/bulk-editor-visible-columns", defaultVisible);
  const columnOrder = useLocalStorage<string[]>(
    "homebox/bulk-editor-column-order",
    builtInColumns.map(column => column.key)
  );

  const reconcileColumnPreferences = () => {
    const keys = allColumns.value.map(column => column.key);
    columnOrder.value = [
      ...columnOrder.value.filter(key => keys.includes(key)),
      ...keys.filter(key => !columnOrder.value.includes(key)),
    ];
    visibleKeys.value = visibleKeys.value.filter(key => keys.includes(key));
    if (!visibleKeys.value.includes("assetId")) visibleKeys.value.unshift("assetId");
  };

  const visibleColumns = computed(() =>
    columnOrder.value
      .map(key => allColumns.value.find(column => column.key === key))
      .filter((column): column is BulkEditorColumn => !!column && visibleKeys.value.includes(column.key))
  );

  const gridColumns = computed<ColumnRegular[]>(() =>
    visibleColumns.value.map(column => ({
      prop: column.key,
      name: column.customField ? column.label : t(column.label),
      readonly: column.readonly,
      editor: column.kind === "textarea" ? RevoGridMultilineEditor : undefined,
      pin: column.key === "assetId" ? "colPinStart" : undefined,
      size:
        column.key === "assetId"
          ? 120
          : column.key === "name"
            ? 240
            : column.kind === "textarea"
              ? 280
              : column.kind === "location" || column.kind === "tags"
                ? 220
                : 170,
      cellProperties: ({ model }) => {
        const row = model as EditorRow;
        const classes = [];
        if (isCellDirty(row, column)) classes.push("bulk-grid-cell-dirty");
        if (row.errors[column.key]) classes.push("bulk-grid-cell-error");
        if (row.saveError && column.key === "assetId") classes.push("bulk-grid-cell-error");
        return {
          class: classes.join(" "),
          title: row.errors[column.key] || (column.key === "assetId" ? row.saveError : ""),
        };
      },
    }))
  );

  const locationPath = (id?: string | null) => {
    const location = flatLocations.value.find(item => item.id === id);
    return location?.treeString.replaceAll(" > ", " / ") ?? "";
  };

  const customValue = (field: EntityFieldData | undefined, definition: EntityFieldDefinition): CellValue => {
    if (!field) return "";
    switch (definition.type) {
      case "number":
        return field.numberValue;
      case "boolean":
        return field.booleanValue;
      case "time":
        return field.timeValue && !field.timeValue.startsWith("0001-") ? field.timeValue.slice(0, 10) : "";
      default:
        return field.textValue;
    }
  };

  const cellValue = (row: EditorRow, column: BulkEditorColumn): CellValue => {
    if (column.customField) return (row[column.key] as CellValue | undefined) ?? "";
    return (row as unknown as Record<string, CellValue>)[column.key] ?? "";
  };

  const snapshotValues = (row: EditorRow) =>
    Object.fromEntries(allColumns.value.map(column => [column.key, cellValue(row, column)]));

  const toEditorRow = (item: EntityOut): EditorRow => {
    const customValues = Object.fromEntries(
      fieldDefinitions.value.map(definition => {
        const field = item.fields.find(
          candidate => candidate.name === definition.name && candidate.type === definition.type
        );
        return [customFieldKey(definition), customValue(field, definition)];
      })
    );
    const row = {
      ...structuredClone(item),
      purchaseDate: String(item.purchaseDate ?? ""),
      soldDate: String(item.soldDate ?? ""),
      warrantyExpires: String(item.warrantyExpires ?? ""),
      locationText: locationPath(item.location?.id),
      tagsText: item.tags.map(tag => tag.name).join("; "),
      customValues,
      originalValues: {},
      errors: {},
      saveError: "",
    } as EditorRow;
    Object.assign(row, customValues);
    row.originalValues = snapshotValues(row);
    return row;
  };

  const isCellDirty = (row: EditorRow, column: BulkEditorColumn) =>
    String(cellValue(row, column)) !== String(row.originalValues[column.key] ?? "");
  const isRowDirty = (row: EditorRow) => allColumns.value.some(column => isCellDirty(row, column));
  const dirtyRows = computed(() => rows.value.filter(isRowDirty));
  const hasUnsavedChanges = computed(() => dirtyRows.value.length > 0);

  const syncRoute = async () => {
    await router.replace({
      query: {
        q: query.value || undefined,
        tag: tagIds.value.length ? tagIds.value : undefined,
        loc: locationIds.value.length ? locationIds.value : undefined,
        archived: includeArchived.value ? "true" : undefined,
        orderBy: orderBy.value === "name" ? undefined : orderBy.value,
        page: page.value === 1 ? undefined : String(page.value),
        pageSize: pageSize.value === 48 ? undefined : String(pageSize.value),
      },
    });
  };

  const confirmDiscard = () => !hasUnsavedChanges.value || window.confirm(t("bulk_edit.discard_confirm"));

  const loadRows = async () => {
    loading.value = true;
    const response = await api.items.getBulkEdit({
      q: query.value,
      tags: tagIds.value,
      parentIds: locationIds.value,
      includeArchived: includeArchived.value,
      orderBy: orderBy.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    loading.value = false;
    if (response.error) {
      toast.error(t("bulk_edit.load_failed"));
      return;
    }
    fieldDefinitions.value = response.data.fieldDefinitions;
    reconcileColumnPreferences();
    rows.value = response.data.items.map(toEditorRow);
    gridSource.value = rows.value;
    total.value = response.data.total;
  };

  const submitFilters = async () => {
    if (!confirmDiscard()) return;
    page.value = 1;
    await syncRoute();
    await loadRows();
  };

  const setPage = async (next: number) => {
    if (next === page.value || !confirmDiscard()) return;
    page.value = next;
    await syncRoute();
    await loadRows();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setCell = (row: EditorRow, column: BulkEditorColumn, value: CellValue) => {
    if (column.customField) row.customValues[column.key] = value;
    (row as unknown as Record<string, CellValue>)[column.key] = value;
    Reflect.deleteProperty(row.errors, column.key);
    row.saveError = "";
  };

  const resolveLocation = (value: string) => {
    const normalized = value.trim().replaceAll(" > ", " / ");
    const byPath = flatLocations.value.filter(item => item.treeString.replaceAll(" > ", " / ") === normalized);
    if (byPath.length === 1) return byPath[0];
    const byName = flatLocations.value.filter(item => item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
    return byName.length === 1 ? byName[0] : undefined;
  };

  const resolveTags = (value: string) => {
    const names = value
      .split(";")
      .map(name => name.trim())
      .filter(Boolean);
    const result = names.map(name =>
      tagStore.tags.filter(tag => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    );
    return result.every(matches => matches.length === 1) ? result.map(matches => matches[0]!) : undefined;
  };

  const validateCell = (row: EditorRow, column: BulkEditorColumn): string => {
    const value = cellValue(row, column);
    if (column.key === "name" && String(value).trim() === "") return t("bulk_edit.errors.required");
    if (column.maxLength && String(value).length > column.maxLength)
      return t("bulk_edit.errors.max_length", { max: column.maxLength });
    if (column.kind === "number" && value !== "") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return t("bulk_edit.errors.number");
      if (column.min !== undefined && parsed < column.min) return t("bulk_edit.errors.minimum", { min: column.min });
      if (column.customField?.type === "number" && !Number.isInteger(parsed)) return t("bulk_edit.errors.integer");
    }
    if (column.kind === "date" && !isDateOnly(String(value))) return t("bulk_edit.errors.date");
    if (column.kind === "boolean" && typeof value !== "boolean" && parseBoolean(String(value)) === null)
      return t("bulk_edit.errors.boolean");
    if (column.kind === "location" && !resolveLocation(String(value))) return t("bulk_edit.errors.location");
    if (column.kind === "tags" && !resolveTags(String(value))) return t("bulk_edit.errors.tags");
    return "";
  };

  const validateRow = (row: EditorRow) => {
    row.errors = {};
    for (const column of allColumns.value) {
      const error = validateCell(row, column);
      if (error) row.errors[column.key] = error;
    }
    return Object.keys(row.errors).length === 0;
  };

  const buildFields = (row: EditorRow): EntityFieldData[] => {
    return fieldDefinitions.value.flatMap(definition => {
      const key = customFieldKey(definition);
      const raw = row[key];
      if (raw === "" || raw === null || raw === undefined) return [];
      const existing = row.fields.find(field => field.name === definition.name && field.type === definition.type);
      const field: EntityFieldData = {
        id: existing?.id ?? "00000000-0000-0000-0000-000000000000",
        name: definition.name,
        type: definition.type,
        textValue: existing?.textValue ?? "",
        numberValue: existing?.numberValue ?? 0,
        booleanValue: existing?.booleanValue ?? false,
        timeValue: existing?.timeValue ?? "0001-01-01T00:00:00Z",
      };
      if (definition.type === "text") field.textValue = String(raw);
      if (definition.type === "number") field.numberValue = Number(raw);
      if (definition.type === "boolean")
        field.booleanValue = typeof raw === "boolean" ? raw : (parseBoolean(String(raw)) ?? false);
      if (definition.type === "time") field.timeValue = new Date(`${String(raw)}T00:00:00Z`).toISOString();
      return [field];
    });
  };

  const buildPatch = (row: EditorRow): EntityPatch => {
    const patch: EntityPatch = { id: row.id, expectedUpdatedAt: String(row.updatedAt) };
    const target = patch as unknown as Record<string, unknown>;
    let customChanged = false;
    for (const column of allColumns.value) {
      if (!isCellDirty(row, column) || column.readonly) continue;
      const value = cellValue(row, column);
      if (column.customField) {
        customChanged = true;
      } else if (column.key === "locationText") {
        target.parentId = resolveLocation(String(value))!.id;
      } else if (column.key === "tagsText") {
        target.tagIds = resolveTags(String(value))!.map(tag => tag.id);
      } else if (column.kind === "number") {
        target[column.key] = Number(value);
      } else if (column.kind === "boolean") {
        target[column.key] = typeof value === "boolean" ? value : parseBoolean(String(value));
      } else {
        target[column.key] = value;
      }
    }
    if (customChanged) patch.fields = buildFields(row);
    return patch;
  };

  const save = async () => {
    if (!dirtyRows.value.length) return;
    const validRows = dirtyRows.value.filter(validateRow);
    if (!validRows.length) {
      toast.error(t("bulk_edit.validation_failed"));
      return;
    }
    const detaching = validRows.filter(row => {
      const locationColumn = allColumns.value.find(column => column.key === "locationText")!;
      return isCellDirty(row, locationColumn) && row.parent && row.location && row.parent.id !== row.location.id;
    });
    if (detaching.length && !window.confirm(t("bulk_edit.detach_confirm", { count: detaching.length }))) return;

    saving.value = true;
    let saved = 0;
    let failed = 0;
    for (const row of validRows) {
      const response = await api.items.patch(row.id, buildPatch(row));
      if (response.error) {
        row.saveError = response.status === 409 ? t("bulk_edit.errors.conflict") : t("bulk_edit.errors.save");
        failed++;
        continue;
      }
      const index = rows.value.findIndex(candidate => candidate.id === row.id);
      rows.value[index] = toEditorRow(response.data);
      saved++;
    }
    saving.value = false;
    gridSource.value = [...rows.value];
    if (saved) toast.success(t("bulk_edit.saved", { count: saved }));
    if (failed) toast.error(t("bulk_edit.failed", { count: failed }));
  };

  const discardAll = () => {
    for (const row of rows.value) {
      for (const column of allColumns.value) setCell(row, column, row.originalValues[column.key] ?? "");
      row.errors = {};
      row.saveError = "";
    }
    gridSource.value = [...rows.value];
  };

  const syncGridModel = (model: EditorRow, onlyKey?: string) => {
    const row = rows.value.find(candidate => candidate.id === model.id);
    if (!row) return;
    const columns = onlyKey ? allColumns.value.filter(column => column.key === onlyKey) : allColumns.value;
    for (const column of columns) {
      if (column.readonly || !(column.key in model)) continue;
      const value = model[column.key];
      setCell(row, column, (value ?? "") as CellValue);
    }
  };

  const onGridAfterEdit = (event: CustomEvent<AfterEditEvent>) => {
    const detail = event.detail;
    if ("models" in detail) {
      Object.values(detail.data).forEach(model => syncGridModel(model as EditorRow));
      return;
    }
    syncGridModel(detail.model as EditorRow, String(detail.prop));
  };

  const onGridWheel = (event: WheelEvent) => {
    if (!event.shiftKey || event.deltaY === 0) return;

    const horizontalScroller = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      "revogr-scroll-virtual.horizontal"
    );
    if (!horizontalScroller || horizontalScroller.scrollWidth <= horizontalScroller.clientWidth) return;

    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 32
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? horizontalScroller.clientWidth
          : 1;
    event.preventDefault();
    event.stopPropagation();
    horizontalScroller.scrollLeft += event.deltaY * multiplier;
  };

  const toggleColumn = (column: BulkEditorColumn, checked: boolean) => {
    if (column.key === "assetId") return;
    visibleKeys.value = checked
      ? [...new Set([...visibleKeys.value, column.key])]
      : visibleKeys.value.filter(key => key !== column.key);
  };
  const moveColumn = (key: string, direction: -1 | 1) => {
    const from = columnOrder.value.indexOf(key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= columnOrder.value.length) return;
    const next = [...columnOrder.value];
    [next[from], next[to]] = [next[to]!, next[from]!];
    columnOrder.value = next;
  };

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges.value) return;
    event.preventDefault();
    event.returnValue = "";
  };
  onBeforeRouteLeave(() => confirmDiscard());
  onMounted(async () => {
    window.addEventListener("beforeunload", beforeUnload);
    await Promise.all([
      tagStore.ensureAllTagsFetched(),
      locationStore.ensureLocationsFetched(),
      locationStore.refreshTree(),
    ]);
    await loadRows();
  });
  onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<template>
  <BaseContainer class="max-w-none">
    <div class="mb-4 flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <div>
          <h1 class="text-2xl font-semibold">{{ $t("bulk_edit.title") }}</h1>
          <p class="text-sm text-muted-foreground">{{ $t("bulk_edit.subtitle") }}</p>
          <p class="text-xs text-muted-foreground">{{ $t("bulk_edit.grid_hint") }}</p>
        </div>
        <div class="grow" />
        <Button variant="outline" :disabled="!hasUnsavedChanges || saving" @click="discardAll">
          <MdiUndo /> {{ $t("bulk_edit.discard") }}
        </Button>
        <Button :disabled="!hasUnsavedChanges || saving" @click="save">
          <MdiLoading v-if="saving" class="animate-spin" />
          <MdiContentSave v-else />
          {{ $t("bulk_edit.save", { count: dirtyRows.length }) }}
        </Button>
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <Input
          v-model="query"
          class="h-10 min-w-64 flex-1"
          :placeholder="$t('global.search')"
          @keyup.enter="submitFilters"
        />
        <SearchFilter v-model="selectedLocations" :label="$t('global.locations')" :options="flatLocations" />
        <SearchFilter v-model="selectedTags" :label="$t('global.tags')" :options="tagStore.tags" />
        <Label class="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
          <Switch v-model="includeArchived" /> {{ $t("items.include_archive") }}
        </Label>
        <Select v-model="orderBy">
          <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{{ $t("items.name") }}</SelectItem>
            <SelectItem value="assetId">{{ $t("items.asset_id") }}</SelectItem>
            <SelectItem value="updatedAt">{{ $t("items.updated_at") }}</SelectItem>
          </SelectContent>
        </Select>
        <Button @click="submitFilters"><MdiMagnify /> {{ $t("global.search") }}</Button>
        <Popover>
          <PopoverTrigger as-child
            ><Button variant="outline" size="icon"><MdiTableCog /></Button
          ></PopoverTrigger>
          <PopoverContent class="max-h-[70vh] w-96 overflow-y-auto">
            <h2 class="mb-2 font-medium">{{ $t("bulk_edit.columns") }}</h2>
            <div
              v-for="column in columnOrder.map(key => allColumns.find(item => item.key === key)).filter(Boolean)"
              :key="column!.key"
              class="flex items-center gap-2 py-1"
            >
              <Button size="icon" variant="ghost" class="size-7" @click="moveColumn(column!.key, -1)"
                ><MdiArrowUp
              /></Button>
              <Button size="icon" variant="ghost" class="size-7" @click="moveColumn(column!.key, 1)"
                ><MdiArrowDown
              /></Button>
              <Checkbox
                :model-value="visibleKeys.includes(column!.key)"
                :disabled="column!.key === 'assetId'"
                @update:model-value="value => toggleColumn(column!, value === true)"
              />
              <span class="truncate text-sm">{{ column!.customField ? column!.label : $t(column!.label) }}</span>
              <span v-if="column!.customField" class="ml-auto text-xs text-muted-foreground">{{
                column!.customField.type
              }}</span>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div class="rounded-md border bg-card">
      <div v-if="loading" class="flex min-h-64 items-center justify-center">
        <MdiLoading class="size-8 animate-spin" />
      </div>
      <div v-else-if="rows.length === 0" class="p-10 text-center text-muted-foreground">
        {{ $t("bulk_edit.no_items") }}
      </div>
      <div
        v-else
        data-testid="bulk-edit-grid"
        class="h-[68vh] min-h-[420px] overflow-hidden rounded-md"
        @wheel.capture="onGridWheel"
      >
        <Grid
          :source="gridSource"
          :columns="gridColumns"
          theme="material"
          :row-headers="true"
          :range="true"
          :resize="true"
          :use-clipboard="{ rangeFill: true }"
          :apply-on-close="true"
          @afteredit="onGridAfterEdit"
        />
      </div>
    </div>

    <div v-if="rows.some(row => Object.keys(row.errors).length || row.saveError)" class="mt-2 text-sm text-destructive">
      <div v-for="row in rows.filter(row => Object.keys(row.errors).length || row.saveError)" :key="row.id">
        {{ row.assetId }} {{ row.name }}:
        {{ row.saveError || Object.values(row.errors).filter(Boolean).join(" / ") }}
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div class="text-sm text-muted-foreground">{{ $t("bulk_edit.results", { total }) }}</div>
      <div class="flex items-center gap-3">
        <Select
          :model-value="String(pageSize)"
          @update:model-value="
            value => {
              pageSize = Number(value);
              submitFilters();
            }
          "
        >
          <SelectTrigger class="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="12">12</SelectItem><SelectItem value="24">24</SelectItem
            ><SelectItem value="48">48</SelectItem><SelectItem value="96">96</SelectItem>
          </SelectContent>
        </Select>
        <Pagination :items-per-page="pageSize" :total="total" :page="page" @update:page="setPage">
          <PaginationList v-slot="{ items }" class="flex items-center gap-1">
            <PaginationFirst /><template v-for="item in items" :key="item.type === 'page' ? item.value : item.type">
              <PaginationListItem v-if="item.type === 'page'" :value="item.value" as-child
                ><Button class="size-9 p-0" :variant="item.value === page ? 'default' : 'outline'">{{
                  item.value
                }}</Button></PaginationListItem
              >
              <PaginationEllipsis v-else :index="0" /> </template
            ><PaginationLast />
          </PaginationList>
        </Pagination>
      </div>
    </div>
  </BaseContainer>
</template>

<style>
  revo-grid {
    --revo-grid-primary: hsl(var(--primary));
    --revo-grid-background: hsl(var(--card));
    --revo-grid-foreground: hsl(var(--card-foreground));
    --revo-grid-text: hsl(var(--card-foreground));
    --revo-grid-border: hsl(var(--border));
    --revo-grid-header-bg: hsl(var(--muted));
    --revo-grid-header-color: hsl(var(--muted-foreground));
    --revo-grid-header-border: hsl(var(--border));
    --revo-grid-cell-border: hsl(var(--border));
    --revo-grid-cell-vertical-border: hsl(var(--border));
    --revo-grid-focused-bg: color-mix(in srgb, hsl(var(--primary)) 12%, transparent);
    --revo-grid-row-hover: color-mix(in srgb, hsl(var(--primary)) 8%, transparent);
    --revo-grid-row-headers-bg: hsl(var(--muted));
    --revo-grid-row-headers-color: hsl(var(--muted-foreground));
    --revo-grid-cell-disabled-bg: color-mix(in srgb, hsl(var(--muted)) 60%, transparent);
    --revo-grid-selection-border: hsl(var(--primary));
    --revo-grid-autofill-handle-bg: hsl(var(--primary));
    --revo-grid-font-family: inherit;
  }

  revo-grid .bulk-grid-cell-dirty {
    background: color-mix(in srgb, hsl(var(--primary)) 12%, transparent);
  }

  revo-grid .bulk-grid-cell-error {
    background: color-mix(in srgb, hsl(var(--destructive)) 16%, transparent);
  }

  revo-grid revogr-edit:has(.bulk-grid-multiline-editor) {
    z-index: 20;
  }

  revo-grid .bulk-grid-multiline-editor {
    box-sizing: border-box;
    width: max(100%, 28rem);
    min-height: 8rem;
    resize: both;
    border: 1px solid hsl(var(--primary));
    border-radius: calc(var(--radius) / 2);
    padding: 0.5rem;
    background: hsl(var(--card));
    color: hsl(var(--card-foreground));
    font: inherit;
    line-height: 1.4;
    white-space: pre-wrap;
  }
</style>
