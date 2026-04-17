<script setup lang="ts">
import { GM } from "$";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ElAlert,
  ElButton,
  ElCard,
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElLink,
  ElOption,
  ElScrollbar,
  ElSelect,
  ElText,
} from "element-plus";

const CONDITION_OPTIONS = [
  "7成新",
  "8成新",
  "9成新",
  "95新",
  "99新",
  "准新",
  "全新仅拆封",
] as const;

type ConditionLabel = (typeof CONDITION_OPTIONS)[number];

const CONDITION_RANK: Record<ConditionLabel, number> = {
  "7成新": 1,
  "8成新": 2,
  "9成新": 3,
  "95新": 4,
  "99新": 5,
  准新: 6,
  全新仅拆封: 7,
};

interface WatcherConfig {
  refreshLowerMinutes: number;
  refreshUpperMinutes: number;
  minCondition: ConditionLabel;
  maxPrice: number;
}

interface ProductItem {
  skuid: string;
  price: number;
  condition: ConditionLabel;
  link: string;
}

interface MatchedProductLogEntry extends ProductItem {
  previousPrice: number | null;
  visited: boolean;
}

interface RunLogEntry {
  id: number;
  runTime: string;
  fetchedCount: number;
  matchedCount: number;
  matchedProducts: MatchedProductLogEntry[];
}

interface ProductRecord {
  price: number;
  visited: boolean;
}

interface ErrorNotice {
  id: number;
  message: string;
  raw: string;
}

const CONFIG_STORAGE_KEY = "config";
const PRODUCT_RECORD_STORAGE_KEY = "product_record";
const LOG_LIMIT = 300;

const DEFAULT_CONFIG: WatcherConfig = {
  refreshLowerMinutes: 10,
  refreshUpperMinutes: 30,
  minCondition: "7成新",
  maxPrice: 10000,
};

const editableConfig = ref<WatcherConfig>({ ...DEFAULT_CONFIG });
const activeConfig = ref<WatcherConfig>({ ...DEFAULT_CONFIG });
const isEditing = ref(true);
const isRunning = ref(false);
let isRunOnceInFlight = false;
const isCollapsed = ref(true);
const statusText = ref("未启动");
const nextRunTime = ref<string | null>(null);
const logs = ref<RunLogEntry[]>([]);
const errorNotice = ref<ErrorNotice | null>(null);

const productRecordBySku = new Map<string, ProductRecord>();

let timerId: number | null = null;
let logIdSeed = 0;
let errorIdSeed = 0;
const panelOffset = ref({ x: 0, y: 0 });

let isDraggingPanel = false;
let dragStartClientX = 0;
let dragStartClientY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

const editButtonText = computed(() => (isEditing.value ? "保存" : "编辑"));
const startButtonText = computed(() => (isRunning.value ? "停止" : "开始"));
const collapseButtonText = computed(() =>
  isCollapsed.value ? "展开" : "折叠",
);
const panelStyle = computed(() => ({
  transform: `translate(${panelOffset.value.x}px, ${panelOffset.value.y}px)`,
}));

const INTERACTIVE_ELEMENT_SELECTOR =
  "button,a,input,textarea,select,option,.el-input,.el-input-number,.el-select,.el-button,.el-link,.el-scrollbar__wrap,.el-scrollbar__bar";

function formatClockLabel(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeCondition(value: unknown): ConditionLabel {
  if (typeof value !== "string") {
    return DEFAULT_CONFIG.minCondition;
  }

  for (const option of CONDITION_OPTIONS) {
    if (option === value) {
      return option;
    }
  }

  return DEFAULT_CONFIG.minCondition;
}

function toErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const stack = typeof error.stack === "string" ? error.stack : "";
    return [error.name, error.message, stack]
      .filter((part) => part.length > 0)
      .join("\n");
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function showError(message: string, error?: unknown): void {
  const raw = error === undefined ? "" : toErrorDetail(error);
  errorNotice.value = {
    id: ++errorIdSeed,
    message,
    raw,
  };
  statusText.value = message;

  if (error !== undefined) {
    console.error("[paipai-watcher]", message, error);
  } else {
    console.error("[paipai-watcher]", message);
  }
}

function clearErrorNotice(): void {
  errorNotice.value = null;
}

function normalizeConfig(input: Partial<WatcherConfig>): WatcherConfig {
  const lowerRaw = toFiniteNumber(
    input.refreshLowerMinutes,
    DEFAULT_CONFIG.refreshLowerMinutes,
  );
  const upperRaw = toFiniteNumber(
    input.refreshUpperMinutes,
    DEFAULT_CONFIG.refreshUpperMinutes,
  );
  const maxPriceRaw = toFiniteNumber(input.maxPrice, DEFAULT_CONFIG.maxPrice);

  const refreshLowerMinutes = Math.max(1, Math.floor(lowerRaw));
  const refreshUpperMinutes = Math.max(
    refreshLowerMinutes,
    Math.floor(upperRaw),
  );

  return {
    refreshLowerMinutes,
    refreshUpperMinutes,
    minCondition: normalizeCondition(input.minCondition),
    maxPrice: Math.max(0, Math.floor(maxPriceRaw)),
  };
}

async function loadConfig(): Promise<void> {
  let stored: Partial<WatcherConfig> | null = null;
  try {
    stored = await GM.getValue<Partial<WatcherConfig> | null>(
      CONFIG_STORAGE_KEY,
      null,
    );
  } catch (error) {
    showError("读取配置失败！", error);
  }

  if (stored === null) {
    editableConfig.value = { ...DEFAULT_CONFIG };
    activeConfig.value = { ...DEFAULT_CONFIG };
    isEditing.value = true;
    return;
  }

  const normalized = normalizeConfig(stored);
  editableConfig.value = { ...normalized };
  activeConfig.value = { ...normalized };
  isEditing.value = false;
}

async function saveConfig(): Promise<boolean> {
  const normalized = normalizeConfig(editableConfig.value);
  editableConfig.value = { ...normalized };
  activeConfig.value = { ...normalized };

  try {
    await GM.setValue(CONFIG_STORAGE_KEY, normalized);
  } catch (error) {
    showError("保存配置失败！", error);
    statusText.value = "配置保存失败！";
    return false;
  }

  isEditing.value = false;
  statusText.value = "配置已保存";
  return true;
}

async function loadProductRecordCache(): Promise<void> {
  productRecordBySku.clear();

  let stored: Record<string, ProductRecord | number> | null = null;
  try {
    stored = await GM.getValue<Record<string, ProductRecord | number> | null>(
      PRODUCT_RECORD_STORAGE_KEY,
      null,
    );
  } catch (error) {
    showError("读取商品记录失败！", error);
  }

  if (stored === null || typeof stored !== "object") {
    return;
  }

  for (const [skuid, rawRecord] of Object.entries(stored)) {
    if (skuid.length === 0) {
      continue;
    }

    const normalizedRecord: ProductRecord =
      typeof rawRecord === "number"
        ? { price: rawRecord, visited: false }
        : {
            price: Number(rawRecord.price),
            visited: rawRecord.visited === true,
          };

    const price = Number(normalizedRecord.price);
    if (!Number.isFinite(price)) {
      continue;
    }

    productRecordBySku.set(skuid, {
      price,
      visited: normalizedRecord.visited,
    });
  }
}

async function persistProductRecordCache(): Promise<boolean> {
  const payload: Record<string, ProductRecord> = {};

  for (const [skuid, record] of productRecordBySku.entries()) {
    payload[skuid] = {
      price: record.price,
      visited: record.visited,
    };
  }

  try {
    await GM.setValue(PRODUCT_RECORD_STORAGE_KEY, payload);
    return true;
  } catch (error) {
    showError("保存商品记录失败！", error);
    return false;
  }
}

async function onEditOrSave(): Promise<void> {
  if (isEditing.value) {
    await saveConfig();
    return;
  }

  isEditing.value = true;
  statusText.value = "正在编辑配置";
}

function clearNextTimer(): void {
  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
}

function randomIntervalSeconds(config: WatcherConfig): number {
  const minSeconds = Math.max(1, config.refreshLowerMinutes * 60);
  const maxSeconds = Math.max(minSeconds, config.refreshUpperMinutes * 60);
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findElementByExactText(text: string): HTMLElement | null {
  const target = text.trim();
  const selector = "taro-view-core,taro-text-core,button,span,div,a";
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  );

  for (const candidate of candidates) {
    if (!isVisible(candidate)) {
      continue;
    }

    if (normalizeText(candidate.textContent) !== target) {
      continue;
    }

    const hasSameTextChild = Array.from(candidate.children).some((child) => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }
      return normalizeText(child.textContent) === target;
    });

    if (hasSameTextChild) {
      continue;
    }

    return candidate;
  }

  return null;
}

function safeClick(element: HTMLElement): void {
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  element.click();
}

async function refreshByPriceAsc(): Promise<void> {
  const sortButton =
    findElementByExactText("价格") ?? findElementByExactText("排序");
  if (sortButton === null) {
    throw new Error("未找到价格或排序按钮");
  }

  const priceTrigger =
    sortButton.closest<HTMLElement>("[class*='filter_trigger_item']") ??
    sortButton;
  safeClick(priceTrigger);
  await sleep(1000);

  const ascOption = findElementByExactText("价格从低到高");
  if (ascOption !== null) {
    safeClick(ascOption);
    await sleep(1000);
  }
}

function parseLeadingNumber(input: string): number | null {
  const match = input.replace(/\s+/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match === null) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractPrice(card: HTMLElement): number | null {
  const priceNode = card.querySelector<HTMLElement>("[class*='price_val']");
  if (priceNode !== null) {
    const parsed = parseLeadingNumber(priceNode.textContent ?? "");
    if (parsed !== null) {
      return parsed;
    }
  }

  const text = card.textContent ?? "";
  const match = text.match(/¥\s*([0-9]+(?:\.[0-9]+)?)/);
  if (match === null) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectConditionLabel(rawText: string): ConditionLabel | null {
  const normalized = normalizeText(rawText).replace(/\s+/g, "");

  for (const option of CONDITION_OPTIONS) {
    if (normalized.includes(option)) {
      return option;
    }
  }

  return null;
}

function extractCondition(card: HTMLElement): ConditionLabel | null {
  const qualityNode = card.querySelector<HTMLElement>(
    "[class*='quality_content']",
  );
  if (qualityNode !== null) {
    const matched = detectConditionLabel(qualityNode.textContent ?? "");
    if (matched !== null) {
      return matched;
    }
  }

  const qualityWrap = card.querySelector<HTMLElement>(
    "[class*='quality_wrap']",
  );
  if (qualityWrap !== null) {
    const matched = detectConditionLabel(qualityWrap.textContent ?? "");
    if (matched !== null) {
      return matched;
    }
  }

  return detectConditionLabel(card.textContent ?? "");
}

function resolveLibraryIdFromLocation(): string {
  const currentUrl = new URL(window.location.href);
  const libraryId = currentUrl.searchParams.get("libraryId")?.trim() ?? "";
  if (libraryId.length === 0) {
    throw new Error("当前页面URL缺少有效的 libraryId 参数");
  }

  return libraryId;
}

function buildProductLink(libraryId: string, skuid: string): string {
  if (skuid.trim().length === 0) {
    throw new Error("商品 skuid 为空，无法构建商品链接");
  }

  const url = new URL("https://paipai.m.jd.com/ppinspect/categoryLibrary");
  url.searchParams.set("libraryId", libraryId);
  url.searchParams.set("topItemIds", skuid);
  url.searchParams.set("act", "report");
  return url.toString();
}

function getTopItemIdsFromLocation(): string[] {
  const currentUrl = new URL(window.location.href);
  const rawValue = currentUrl.searchParams.get("topItemIds")?.trim() ?? "";
  if (rawValue.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  );
}

function collectProducts(): ProductItem[] {
  const libraryId = resolveLibraryIdFromLocation();
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-inspectskuid]"),
  );
  const items: ProductItem[] = [];

  for (const card of cards) {
    const skuid = card.getAttribute("data-inspectskuid")?.trim();
    if (skuid === undefined || skuid.length === 0) {
      continue;
    }

    const price = extractPrice(card);
    const condition = extractCondition(card);
    if (price === null || condition === null) {
      continue;
    }

    items.push({
      skuid,
      price,
      condition,
      link: buildProductLink(libraryId, skuid),
    });
  }

  return items;
}

function isItemMatched(item: ProductItem, config: WatcherConfig): boolean {
  return (
    CONDITION_RANK[item.condition] >= CONDITION_RANK[config.minCondition] &&
    item.price <= config.maxPrice
  );
}

function appendRunLog(entry: Omit<RunLogEntry, "id">): void {
  logs.value.unshift({
    id: ++logIdSeed,
    ...entry,
  });

  if (logs.value.length > LOG_LIMIT) {
    logs.value.length = LOG_LIMIT;
  }
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatLogPrice(entry: MatchedProductLogEntry): string {
  if (entry.previousPrice === null) {
    return `¥${formatPrice(entry.price)}`;
  }

  return `¥${formatPrice(entry.previousPrice)} → ¥${formatPrice(entry.price)}`;
}

function syncLogVisitedState(): void {
  logs.value = logs.value.map((runLog) => {
    let changed = false;
    const matchedProducts = runLog.matchedProducts.map((entry) => {
      const visited =
        productRecordBySku.get(entry.skuid)?.visited ?? entry.visited;
      if (visited === entry.visited) {
        return entry;
      }

      changed = true;
      return {
        ...entry,
        visited,
      };
    });

    if (!changed) {
      return runLog;
    }

    return {
      ...runLog,
      matchedProducts,
    };
  });
}

function markVisitedByCurrentLocation(): boolean {
  const topItemIds = getTopItemIdsFromLocation();
  if (topItemIds.length === 0) {
    return false;
  }

  let changed = false;
  for (const skuid of topItemIds) {
    const record = productRecordBySku.get(skuid);
    if (record === undefined || record.visited) {
      continue;
    }

    productRecordBySku.set(skuid, {
      price: record.price,
      visited: true,
    });
    changed = true;
  }

  if (changed) {
    syncLogVisitedState();
  }

  return changed;
}

async function onClearProductRecordData(): Promise<void> {
  productRecordBySku.clear();
  const persisted = await persistProductRecordCache();
  if (!persisted) {
    statusText.value = "商品记录清除失败！";
    return;
  }

  statusText.value =
    isRunning.value && nextRunTime.value !== null
      ? `下次刷新时间：${nextRunTime.value}`
      : "商品记录已清除";
}

async function refreshVisitedStateFromStorage(): Promise<void> {
  await loadProductRecordCache();
  syncLogVisitedState();

  const changed = markVisitedByCurrentLocation();
  if (changed) {
    await persistProductRecordCache();
  }
}

async function notifyMatchedItems(count: number): Promise<void> {
  if (count <= 0) {
    return;
  }

  const notificationText = `监测到${count}件新商品！`;

  try {
    await Promise.resolve(
      GM.notification({
        title: "paipai-watcher",
        text: notificationText,
      }),
    );
  } catch (error) {
    throw new Error(`GM.notification 发送失败: ${toErrorDetail(error)}`);
  }
}

function toggleCollapsed(): void {
  isCollapsed.value = !isCollapsed.value;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest(INTERACTIVE_ELEMENT_SELECTOR) !== null;
}

function onPanelMouseMove(event: MouseEvent): void {
  if (!isDraggingPanel) {
    return;
  }

  panelOffset.value = {
    x: dragStartOffsetX + (event.clientX - dragStartClientX),
    y: dragStartOffsetY + (event.clientY - dragStartClientY),
  };
}

function stopPanelDrag(): void {
  if (!isDraggingPanel) {
    return;
  }

  isDraggingPanel = false;
  window.removeEventListener("mousemove", onPanelMouseMove);
  window.removeEventListener("mouseup", stopPanelDrag);
}

function onPanelMouseDown(event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }

  if (isInteractiveTarget(event.target)) {
    return;
  }

  event.preventDefault();

  isDraggingPanel = true;
  dragStartClientX = event.clientX;
  dragStartClientY = event.clientY;
  dragStartOffsetX = panelOffset.value.x;
  dragStartOffsetY = panelOffset.value.y;

  window.addEventListener("mousemove", onPanelMouseMove);
  window.addEventListener("mouseup", stopPanelDrag);
}

async function runOnce(): Promise<void> {
  if (!isRunning.value || isRunOnceInFlight) {
    return;
  }

  isRunOnceInFlight = true;
  const runTime = formatClockLabel();

  try {
    await refreshByPriceAsc();
    await sleep(2000);

    const products = collectProducts();
    const sortedProducts = products
      .map((product, domIndex) => ({ product, domIndex }))
      .sort(
        (left, right) =>
          left.product.price - right.product.price ||
          left.domIndex - right.domIndex,
      )
      .map((entry) => entry.product);

    let hitCount = 0;
    let recordCacheChanged = false;
    const matchedProducts: MatchedProductLogEntry[] = [];

    for (const product of sortedProducts) {
      const record = productRecordBySku.get(product.skuid);
      const previousPrice = record?.price;
      const priceChanged =
        previousPrice === undefined || previousPrice !== product.price;

      if (!priceChanged) {
        continue;
      }

      const matched = isItemMatched(product, activeConfig.value);
      if (!matched) {
        continue;
      }

      productRecordBySku.set(product.skuid, {
        price: product.price,
        visited: false,
      });
      recordCacheChanged = true;

      matchedProducts.push({
        skuid: product.skuid,
        price: product.price,
        previousPrice: previousPrice ?? null,
        condition: product.condition,
        link: product.link,
        visited: false,
      });
      hitCount += 1;
    }

    appendRunLog({
      runTime,
      fetchedCount: sortedProducts.length,
      matchedCount: hitCount,
      matchedProducts,
    });

    if (recordCacheChanged) {
      const persisted = await persistProductRecordCache();
      if (!persisted) {
        statusText.value = "商品记录保存失败！";
        return;
      }
    }

    void notifyMatchedItems(hitCount); // 不进行await，避免通知阻塞脚本调度
  } catch (error) {
    showError("执行失败，请查看错误详情", error);
  } finally {
    isRunOnceInFlight = false;
  }
}

function scheduleNextRun(): void {
  if (!isRunning.value) {
    return;
  }

  const waitSeconds = randomIntervalSeconds(activeConfig.value);
  const runAt = new Date(Date.now() + waitSeconds * 1000);
  nextRunTime.value = formatClockLabel(runAt);
  statusText.value = `下次刷新时间：${nextRunTime.value}`;
  timerId = window.setTimeout(async () => {
    await runOnce();
    scheduleNextRun();
  }, waitSeconds * 1000);
}

function stopWatcher(): void {
  clearNextTimer();
  nextRunTime.value = null;
  isRunning.value = false;
  statusText.value = "已停止";
}

async function onStartOrStop(): Promise<void> {
  if (isRunning.value) {
    stopWatcher();
    return;
  }

  if (isEditing.value) {
    const saved = await saveConfig();
    if (!saved) {
      return;
    }
  }

  clearNextTimer();
  isRunning.value = true;
  statusText.value = "运行中";
  await runOnce();
  scheduleNextRun();
}

async function initializeData(): Promise<void> {
  await loadConfig();
  await refreshVisitedStateFromStorage();
  if (errorNotice.value === null) {
    statusText.value = "待启动";
  }
}

function onWindowFocus(): void {
  void refreshVisitedStateFromStorage();
}

onMounted(() => {
  window.addEventListener("focus", onWindowFocus);
  void initializeData();
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  stopPanelDrag();
  clearNextTimer();
});
</script>

<template>
  <div
    class="ppw-panel-root"
    :class="{
      'ppw-panel-root--collapsed': isCollapsed,
      'ppw-panel-root--expanded': !isCollapsed,
    }"
    :style="panelStyle"
    @mousedown="onPanelMouseDown"
  >
    <div v-if="errorNotice !== null" class="ppw-error-toast">
      <ElAlert
        :key="errorNotice.id"
        class="ppw-error-alert"
        :title="errorNotice.message"
        :description="errorNotice.raw || '无更多原始信息'"
        type="error"
        show-icon
        closable
        @close="clearErrorNotice"
      />
    </div>

    <ElCard class="ppw-panel" shadow="always">
      <div class="ppw-config-head">
        <h3 class="ppw-section-title">
          {{ isCollapsed ? "paipai-watcher" : "配置" }}
        </h3>
        <ElButton type="primary" link @click="toggleCollapsed">
          {{ collapseButtonText }}
        </ElButton>
      </div>

      <Transition name="ppw-expand">
        <div v-if="!isCollapsed" class="ppw-expand-content">
          <section class="ppw-section ppw-config-section">
            <ElForm label-position="right" label-width="86px" class="ppw-form">
              <ElFormItem label="刷新间隔">
                <div class="ppw-range-row">
                  <ElInputNumber
                    v-model="editableConfig.refreshLowerMinutes"
                    :min="1"
                    :step="1"
                    :precision="0"
                    :disabled="!isEditing"
                    controls-position="right"
                  />
                  <span class="ppw-inline-separator">-</span>
                  <ElInputNumber
                    v-model="editableConfig.refreshUpperMinutes"
                    :min="1"
                    :step="1"
                    :precision="0"
                    :disabled="!isEditing"
                    controls-position="right"
                  />
                  <span class="ppw-inline-unit">分钟</span>
                </div>
              </ElFormItem>

              <ElFormItem label="最低成色">
                <ElSelect
                  v-model="editableConfig.minCondition"
                  :disabled="!isEditing"
                  popper-class="ppw-select-popper"
                >
                  <ElOption
                    v-for="option in CONDITION_OPTIONS"
                    :key="option"
                    :label="option"
                    :value="option"
                  />
                </ElSelect>
              </ElFormItem>

              <ElFormItem label="最高价格">
                <div class="ppw-price-row">
                  <ElInputNumber
                    v-model="editableConfig.maxPrice"
                    :min="0"
                    :step="1"
                    :precision="0"
                    :disabled="!isEditing"
                    controls-position="right"
                  />
                  <span class="ppw-inline-unit">元</span>
                </div>
              </ElFormItem>
            </ElForm>

            <div class="ppw-actions">
              <ElButton type="primary" @click="onStartOrStop">
                {{ startButtonText }}
              </ElButton>
              <ElButton
                :type="isEditing ? 'success' : 'default'"
                @click="onEditOrSave"
              >
                {{ editButtonText }}
              </ElButton>
            </div>

            <div class="ppw-status">
              <ElText size="small">{{ statusText }}</ElText>
            </div>
          </section>

          <section class="ppw-section ppw-log-section">
            <div class="ppw-log-head">
              <h3 class="ppw-section-title ppw-log-title">监测记录</h3>
              <ElButton
                class="ppw-clear-data-button"
                type="danger"
                link
                @click="onClearProductRecordData"
              >
                清除商品数据
              </ElButton>
            </div>
            <ElScrollbar height="100%" class="ppw-log-scrollbar">
              <div v-if="logs.length === 0" class="ppw-empty-log">
                <ElText type="info">暂无记录</ElText>
              </div>

              <article
                v-for="runLog in logs"
                :key="runLog.id"
                class="ppw-run-log-item"
              >
                <p class="ppw-run-summary">
                  {{
                    `${runLog.runTime} 本次抓取到${runLog.fetchedCount}个商品，` +
                    (runLog.matchedCount > 0
                      ? `其中有${runLog.matchedCount}个满足筛选条件！`
                      : "没有满足条件的新商品！")
                  }}
                </p>

                <div
                  v-if="runLog.matchedCount > 0"
                  class="ppw-run-matched-products"
                >
                  <article
                    v-for="(entry, itemIndex) in runLog.matchedProducts"
                    :key="`${runLog.id}-${itemIndex}-${entry.skuid}`"
                    class="ppw-log-item"
                    :class="
                      entry.visited
                        ? 'ppw-log-item--visited'
                        : 'ppw-log-item--unread'
                    "
                  >
                    <div class="ppw-log-main">
                      <div class="ppw-log-headline">
                        <span v-if="!entry.visited" class="ppw-unread-dot" />
                        <span class="ppw-log-content">
                          {{ formatLogPrice(entry) }} | {{ entry.condition }} |
                          SKU {{ entry.skuid }}
                        </span>
                        <ElLink
                          class="ppw-log-link"
                          :href="entry.link"
                          type="primary"
                          target="_blank"
                        >
                          商品详情
                        </ElLink>
                      </div>
                    </div>
                  </article>
                </div>
              </article>
            </ElScrollbar>
          </section>
        </div>
      </Transition>
    </ElCard>
  </div>
</template>

<style scoped>
.ppw-panel-root {
  pointer-events: auto;
  width: 33vw; /* 面板宽度为浏览器窗口宽度的 33% */
  min-width: 360px;
  font-size: 14px;
  line-height: 1.4;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  transition:
    width 0.28s ease,
    min-width 0.28s ease;
}

.ppw-panel-root--collapsed {
  width: 220px;
  min-width: 220px;
}

.ppw-panel-root--expanded .ppw-panel {
  height: 80vh;
  display: flex;
  flex-direction: column;
}

.ppw-expand-content {
  overflow: hidden;
}

.ppw-panel-root--expanded .ppw-expand-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ppw-expand-enter-active,
.ppw-expand-leave-active {
  transition:
    max-height 0.28s ease,
    opacity 0.24s ease,
    transform 0.24s ease;
  overflow: hidden;
}

.ppw-expand-enter-from,
.ppw-expand-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-8px);
}

.ppw-expand-enter-to,
.ppw-expand-leave-from {
  max-height: 760px;
  opacity: 1;
  transform: translateY(0);
}

:global(.ppw-select-popper) {
  z-index: 2147483647 !important;
}

.ppw-error-toast {
  position: fixed;
  top: 12px;
  left: 12px;
  width: min(560px, calc(100vw - 24px));
  z-index: 2147483646;
  pointer-events: auto;
}

.ppw-error-alert :deep(.el-alert__description) {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow: auto;
}

.ppw-panel {
  border-radius: 12px;
  border: 1px solid #dcdfe6;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(6px);
}

.ppw-config-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.ppw-config-section {
  margin-top: 8px;
}

.ppw-panel-root--expanded .ppw-config-section {
  margin-top: 0;
  padding-top: 8px;
  flex: 0 0 33%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.ppw-panel-root--expanded .ppw-log-section {
  flex: 0 0 67%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ppw-section + .ppw-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #ebeef5;
}

.ppw-panel-root--expanded .ppw-section + .ppw-section {
  margin-top: 0;
  padding-top: 10px;
}

.ppw-section-title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: #303133;
}

.ppw-log-title {
  margin-bottom: 8px;
}

.ppw-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ppw-clear-data-button {
  padding: 0;
}

.ppw-form :deep(.el-input-number) {
  width: 84px;
}

.ppw-form :deep(.el-select) {
  width: 208px;
}

.ppw-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.ppw-form :deep(.el-form-item__label) {
  white-space: nowrap;
}

.ppw-range-row,
.ppw-price-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ppw-inline-separator,
.ppw-inline-unit {
  color: #606266;
  font-size: 12px;
  line-height: 1;
}

.ppw-price-row :deep(.el-input-number) {
  width: 150px;
}

.ppw-actions {
  display: flex;
  gap: 8px;
}

.ppw-actions :deep(.el-button) {
  flex: 1;
}

.ppw-status {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ppw-log-scrollbar {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 8px;
}

.ppw-panel-root--expanded .ppw-log-scrollbar {
  height: 100%;
  min-height: 0;
}

.ppw-empty-log {
  min-height: 56px;
  display: grid;
  place-items: center;
}

.ppw-run-log-item + .ppw-run-log-item {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #dcdfe6;
}

.ppw-run-summary {
  margin: 0;
  color: #606266;
  font-size: 12px;
  line-height: 18px;
}

.ppw-run-matched-products {
  margin-top: 8px;
}

.ppw-log-item + .ppw-log-item {
  margin-top: 8px;
}

.ppw-log-item {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 8px 10px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.ppw-log-item--unread {
  background: #ecf5ff;
  border-color: #d9ecff;
}

.ppw-log-item--visited {
  background: #f5f7fa;
  border-color: #ebeef5;
}

.ppw-log-headline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ppw-unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #409eff;
  flex: 0 0 auto;
}

.ppw-log-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ppw-log-content {
  color: #303133;
  font-size: 13px;
  line-height: 20px;
}

.ppw-log-item--visited .ppw-log-content {
  color: #909399;
}

.ppw-log-link {
  display: inline-flex;
  margin-left: 6px;
  width: auto;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .ppw-panel-root {
    width: 100%;
    min-width: 0;
  }

  .ppw-panel-root--collapsed {
    width: min(72vw, 220px);
    min-width: 0;
  }

  .ppw-form :deep(.el-select) {
    width: 100%;
  }
}
</style>
