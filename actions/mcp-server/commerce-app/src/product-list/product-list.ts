/**
 * Product List MCP App — interactive UI for the `show-products` tool.
 *
 * Data flow:
 * 1. Host invokes `show-products` → server returns structuredContent → `ontoolresult` renders cards.
 * 2. User filters via keywords → UI calls `app.callServerTool` to re-invoke `show-products`.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "../global.css";
import "./product-list.css";

const CARDS_VISIBLE_INITIAL = 3;
const CARDS_PER_LOAD = 3;

/** DOM refs — must match ids/classes in product-list.html */
const carouselTrack = document.getElementById("carousel-track")!;
const carouselContainer = document.getElementById("carousel-container")!;
const loadMoreRow = document.getElementById("load-more-row")!;
const loadMoreBtn = document.getElementById("load-more-btn")!;
const loadMoreLabel = document.getElementById("load-more-label")!;
const loaderEl = document.getElementById("loader")!;
const emptyMessage = document.getElementById("empty-message")!;
const errorMessage = document.getElementById("error-message") as HTMLParagraphElement;
const filterRow = document.getElementById("filter-row")!;
const keywordsInput = document.getElementById("keywords-input") as HTMLInputElement;
const filterBtn = document.getElementById("filter-btn")!;
const titleEl = document.querySelector(".title") as HTMLElement;
const subtitleEl = document.querySelector(".subtitle") as HTMLElement;
const mainEl = document.querySelector(".main") as HTMLElement;

/** Build-time labels from .env (VITE_*), injected by Vite at compile time */
const APPLICATION_TITLE =
  (import.meta.env?.VITE_APPLICATION_TITLE as string) || "Product List";
const APPLICATION_SUBTITLE =
  (import.meta.env?.VITE_SUB_TITLE as string) ||
  "Explore the latest products and promotions.";

/** In-memory product rows from the latest successful tool result */
let currentCarouselData: CarouselRow[] = [];
/** Site origin for resolving relative image paths from structuredContent.baseURL */
let currentBaseURL: string | undefined;
/** How many cards are currently rendered (grows via Load more) */
let visibleCount = CARDS_VISIBLE_INITIAL;

type CarouselRow = Record<string, string | number>;

/** Shape of structuredContent returned by the `show-products` tool handler */
type ToolStructured = {
  data?: CarouselRow[];
  columns?: string[];
  total?: number;
  baseURL?: string;
};

function setLoading(loading: boolean) {
  loaderEl.hidden = !loading;
  loaderEl.setAttribute("aria-busy", loading ? "true" : "false");
  if (loading) {
    carouselContainer.hidden = true;
    loadMoreRow.hidden = true;
    emptyMessage.hidden = true;
    errorMessage.hidden = true;
    carouselTrack.innerHTML = "";
  }
}

function getStructured(result: CallToolResult): ToolStructured | null {
  // Host sends structuredContent alongside content[] for MCP App UIs
  if (result.isError) return null;
  const raw = result.structuredContent as ToolStructured | undefined;
  return raw ?? null;
}

function escapeHtml(s: string): string {
  // Safe text insertion when building card HTML from API data
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const CARD_ACCENTS = ["#3d2b1f", "#7a1f2b", "#1f4d3a"];

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250"><rect fill="#e2e8f0" width="400" height="250"/><text x="50%" y="50%" fill="#94a3b8" font-size="16" font-family="sans-serif" text-anchor="middle" dy=".3em">No image</text></svg>'
  );

function getImageUrl(row: CarouselRow, baseURL?: string): string {
  // Accept common field names from query-index / sheet-style JSON
  const raw =
    row.image ??
    row.thumbnail ??
    (row as Record<string, unknown>).imageUrl ??
    row.img ??
    "";
  const s = typeof raw === "string" ? raw : String((raw as { url?: string })?.url ?? "").trim();
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const pathPart = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (baseURL?.trim()) {
    const base = baseURL.replace(/\/$/, "");
    return `${base}${pathPart}`;
  }
  return pathPart;
}

function getCardAccent(index: number): string {
  return CARD_ACCENTS[index % CARD_ACCENTS.length];
}

function getCardVolume(row: CarouselRow): string {
  const raw =
    row.volume ??
    row.subtitle ??
    row.navtitle ??
    (row as Record<string, unknown>).sizeLabel ??
    "";
  return String(raw).trim();
}

function formatPriceValue(
  price: string | number | undefined,
  currency?: string | number
): string {
  if (price == null || price === "") return "";
  const s = String(price).trim();
  if (/[^0-9.,\s]/.test(s)) return s;
  const num = Number(s.replace(/,/g, ""));
  if (Number.isNaN(num)) return s;
  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const currencyStr = currency != null ? String(currency).trim() : "";
  return currencyStr ? `${currencyStr} ${formatted}` : `$${formatted}`;
}

function renderCardPrice(row: CarouselRow): string {
  const current = formatPriceValue(row.price, row.currency);
  if (!current) return "";
  const original = formatPriceValue(
    row.originalPrice ?? row.compareAtPrice,
    row.currency
  );
  const originalHtml =
    original && original !== current
      ? `<span class="card-price-original">${escapeHtml(original)}</span>`
      : "";
  return `<div class="card-price"><span class="card-price-current">${escapeHtml(current)}</span>${originalHtml}</div>`;
}

function renderCard(row: CarouselRow, baseURL: string | undefined, index: number): string {
  // Builds one product card; index drives accent color rotation
  const title = escapeHtml(String(row.title ?? "Untitled"));
  const description = escapeHtml(String(row.description ?? "").trim());
  const image = getImageUrl(row, baseURL);
  const accent = getCardAccent(index);
  const volume = getCardVolume(row);
  const priceHtml = renderCardPrice(row);

  const imgHtml = image
    ? `<img class="card-image" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'">`
    : `<img class="card-image card-image--placeholder" src="${PLACEHOLDER_IMAGE}" alt="" role="presentation">`;

  const volumeHtml = volume
    ? `<span class="card-volume">(${escapeHtml(volume)})</span>`
    : "";
  const descriptionHtml = description
    ? `<p class="card-description">${description}</p>`
    : "";

  return `
    <article class="card" style="--card-accent: ${accent}">
      <div class="card-content">
        <div class="card-hero">
          <div class="card-hero-bg" aria-hidden="true"></div>
          <div class="card-image-wrap">${imgHtml}</div>
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <h2 class="card-title">${title}</h2>
            ${volumeHtml}
          </div>
          ${descriptionHtml}
          <div class="card-size" aria-hidden="true">
            <span class="card-size-label">Size:</span>
            <span class="card-size-options"><span>S</span><span class="is-active">M</span><span>L</span></span>
          </div>
          <div class="card-footer${priceHtml ? "" : " card-footer--cta-only"}">
            ${priceHtml}
            <!-- Display-only CTA; no click handler wired -->
            <span class="card-visit-btn">View Details</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderVisibleCards() {
  const data = currentCarouselData;
  const total = data.length;

  // Render all visible cards in one track so "load more" continues inline after the 3rd item.
  carouselTrack.innerHTML = data
    .slice(0, visibleCount)
    .map((row, i) => renderCard(row, currentBaseURL, i))
    .join("");

  loadMoreRow.hidden = total <= CARDS_VISIBLE_INITIAL;
  if (!loadMoreRow.hidden) {
    const totalFmt = total.toLocaleString();
    const visibleFmt = visibleCount.toLocaleString();
    loadMoreLabel.innerHTML =
      visibleCount >= total
        ? `Showing all <strong>${totalFmt}</strong> cards`
        : `Showing ${visibleFmt} of <strong>${totalFmt}</strong> cards`;
    (loadMoreBtn as HTMLButtonElement).hidden = visibleCount >= total;
  }
}

function renderCarousel(structured: ToolStructured) {
  const data = structured.data ?? [];
  const total = structured.total ?? data.length;

  errorMessage.hidden = true;
  errorMessage.textContent = "";

  if (data.length === 0) {
    // Distinguish empty catalog vs. filter with no matches via `total`
    carouselContainer.hidden = true;
    loadMoreRow.hidden = true;
    emptyMessage.hidden = false;
    emptyMessage.textContent = total === 0
      ? "No cards to show. Invoke the tool (optionally with keywords to filter)."
      : "No cards match the current filter.";
    carouselTrack.innerHTML = "";
    return;
  }

  currentCarouselData = data;
  currentBaseURL = structured.baseURL;
  visibleCount = Math.min(CARDS_VISIBLE_INITIAL, data.length);
  carouselContainer.hidden = false;
  emptyMessage.hidden = true;
  renderVisibleCards();
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  // Sync theme, typography, and safe-area insets from the MCP host (e.g. Cursor, Claude).
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    mainEl.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

function applyToolResult(result: CallToolResult) {
  // Shared handler for the initial tool result and follow-up `callServerTool` responses.
  setLoading(false);

  if (result.isError) {
    const content = result.content ?? [];
    const textItem = content.find((c): c is { type: "text"; text: string } => c.type === "text");
    errorMessage.textContent = textItem?.text ?? "An error occurred.";
    errorMessage.hidden = false;
    carouselContainer.hidden = true;
    loadMoreRow.hidden = true;
    emptyMessage.hidden = true;
    filterRow.hidden = true;
    carouselTrack.innerHTML = "";
    return;
  }
  const structured = getStructured(result);
  if (structured) {
    filterRow.hidden = false;
    renderCarousel(structured);
  }
}

/** MCP App client identity — sent to the host during `app.connect()` ui/initialize handshake */
const app = new App({ name: "Product List App", version: "1.0.0" });

/**
 * MCP App lifecycle callbacks — wired to the host's tool execution and UI context.
 * See https://modelcontextprotocol.github.io/ext-apps/ for the full App API.
 */

/** Called when the host tears down this view (navigation away, panel close, etc.). */
app.onteardown = async () => ({});

/**
 * Fired when the host starts streaming tool input (before the result arrives).
 * Show a loading state so the user knows data is on the way.
 */
app.ontoolinput = () => {
  setLoading(true);
};

/**
 * Fired when `show-products` completes — either from the host's initial invocation
 * or from a follow-up `app.callServerTool` (e.g. keyword filter).
 */
app.ontoolresult = applyToolResult;

/** Fired when the host cancels an in-flight tool call. Restore a neutral empty state. */
app.ontoolcancelled = () => {
  setLoading(false);
  carouselContainer.hidden = true;
  emptyMessage.hidden = false;
  emptyMessage.textContent = "Request cancelled.";
};

/** Surface SDK / transport errors to the browser console. */
app.onerror = console.error;

/**
 * Fired when the host updates theme, fonts, or layout insets.
 * Keeps the embedded UI visually consistent with the host shell.
 */
app.onhostcontextchanged = handleHostContextChanged;

/**
 * Re-invoke `show-products` on the server with the current keyword filter.
 * Unlike `sendMessage`, `callServerTool` stays inside this MCP App and returns
 * structured content directly to `ontoolresult`.
 */
filterBtn.addEventListener("click", async () => {
  const keywords = keywordsInput.value.trim();
  setLoading(true);
  try {
    const result = await app.callServerTool({
      name: "show-products",
      arguments: { keywords: keywords || undefined },
    });
    applyToolResult(result);
  } catch (e) {
    console.error(e);
    setLoading(false);
    errorMessage.textContent = e instanceof Error ? e.message : "Filter request failed.";
    errorMessage.hidden = false;
  }
});

keywordsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") filterBtn.click();
});

/** Paginate additional cards client-side without another server round-trip. */
loadMoreBtn.addEventListener("click", () => {
  visibleCount = Math.min(
    visibleCount + CARDS_PER_LOAD,
    currentCarouselData.length
  );
  renderVisibleCards();
});

/**
 * Connect to the MCP host and complete initial UI setup.
 * `setLoading(true)` expects the host to invoke `show-products` shortly after connect;
 * the result arrives via `ontoolresult`.
 */
app.connect().then(() => {
  if (titleEl) {
    titleEl.textContent = APPLICATION_TITLE;
  }
  if (subtitleEl) {
    subtitleEl.textContent = APPLICATION_SUBTITLE;
  }
  document.title = APPLICATION_TITLE;
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
  setLoading(true);
});
