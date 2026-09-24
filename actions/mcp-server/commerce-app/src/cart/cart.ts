/**
 * Shopping Cart MCP App — lists all items added during the conversation.
 *
 * Data flow:
 * 1. Host invokes `show-cart` with the full items array → `ontoolresult` renders the bag.
 * 2. Typically invoked after add-to-bag on product detail (host merges prior items + new line).
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
import "./cart.css";

type Product = {
  title?: string;
  subtitle?: string;
  image?: string;
  price?: string | number;
  currency?: string;
  path?: string;
  link?: string;
  [key: string]: unknown;
};

type CartLine = {
  product: Product;
  quantity: number;
};

type ToolStructured = {
  items?: CartLine[];
  itemCount?: number;
  subtotal?: number;
  subtotalFormatted?: string;
  currency?: string;
};

let pendingToolArgs: Record<string, unknown> | null = null;
let hasRenderedItems = false;

const loaderEl = document.getElementById("loader")!;
const errorMessage = document.getElementById("error-message") as HTMLParagraphElement;
const emptyMessage = document.getElementById("empty-message")!;
const cartItemsEl = document.getElementById("cart-items")!;
const cartFooter = document.getElementById("cart-footer")!;
const cartSummary = document.getElementById("cart-summary")!;
const cartSubtotal = document.getElementById("cart-subtotal")!;
const mainEl = document.querySelector(".main") as HTMLElement;

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect fill="#e2e8f0" width="80" height="80"/><text x="50%" y="50%" fill="#94a3b8" font-size="10" font-family="sans-serif" text-anchor="middle" dy=".3em">No image</text></svg>'
  );

function setLoading(loading: boolean) {
  loaderEl.hidden = !loading;
  loaderEl.setAttribute("aria-busy", loading ? "true" : "false");
  if (loading) {
    cartItemsEl.hidden = true;
    cartFooter.hidden = true;
    emptyMessage.hidden = true;
    errorMessage.hidden = true;
    cartSummary.hidden = true;
  }
}

function showError(message: string) {
  setLoading(false);
  cartItemsEl.hidden = true;
  cartFooter.hidden = true;
  emptyMessage.hidden = true;
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function parseUnitPrice(product: Product): number {
  const { price } = product;
  if (price == null || price === "") return 0;
  const s = String(price).trim();
  const numeric = s.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const num = Number(numeric);
  return Number.isNaN(num) ? 0 : num;
}

function formatLinePrice(product: Product, quantity: number): string {
  const unit = parseUnitPrice(product);
  if (unit <= 0) return "";
  const total = unit * quantity;
  const formatted = total.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const currency = product.currency ? String(product.currency) : "";
  return currency ? `${currency} ${formatted}` : formatted;
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as CartLine;
  return line.product != null && typeof line.product === "object";
}

function structuredFromArgs(args: Record<string, unknown> | null): ToolStructured | null {
  if (!args) return null;
  const items = args.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines = items.filter(isCartLine);
  if (lines.length === 0) return null;
  return { items: lines };
}

function getStructured(result: CallToolResult): ToolStructured | null {
  if (result.isError) return null;

  const raw = result.structuredContent;
  if (Array.isArray(raw)) {
    const lines = raw.filter(isCartLine);
    return lines.length > 0 ? { items: lines } : null;
  }

  if (raw && typeof raw === "object") {
    const structured = raw as ToolStructured;
    if (Array.isArray(structured.items) && structured.items.length > 0) {
      return structured;
    }
  }

  // Some hosts flatten structured fields onto the tool result.
  const flat = result as CallToolResult & ToolStructured;
  if (Array.isArray(flat.items) && flat.items.length > 0) {
    return {
      items: flat.items,
      itemCount: flat.itemCount,
      subtotal: flat.subtotal,
      subtotalFormatted: flat.subtotalFormatted,
      currency: flat.currency,
    };
  }

  return structuredFromArgs(pendingToolArgs);
}

function renderCart(structured: ToolStructured) {
  const items = structured.items ?? [];
  const itemCount = structured.itemCount ?? items.reduce((n, i) => n + i.quantity, 0);

  setLoading(false);
  errorMessage.hidden = true;

  if (items.length === 0) {
    hasRenderedItems = false;
    cartItemsEl.hidden = true;
    cartFooter.hidden = true;
    cartSummary.hidden = true;
    emptyMessage.hidden = false;
    return;
  }

  hasRenderedItems = true;
  emptyMessage.hidden = true;
  cartSummary.textContent =
    itemCount === 1 ? "1 item in your bag" : `${itemCount} items in your bag`;
  cartSummary.hidden = false;

  cartItemsEl.innerHTML = items
    .map((line) => {
      const { product, quantity } = line;
      const title = escapeHtml(String(product.title ?? "Untitled"));
      const image = product.image ? escapeHtml(String(product.image)) : PLACEHOLDER_IMAGE;
      const linePrice = formatLinePrice(product, quantity);
      return `
        <li class="cart-item">
          <div class="cart-item-image-wrap">
            <img class="cart-item-image" src="${image}" alt="" loading="lazy" decoding="async"
              onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'">
          </div>
          <div class="cart-item-info">
            <p class="cart-item-title">${title}</p>
            <p class="cart-item-qty">Qty ${quantity}</p>
          </div>
          ${linePrice ? `<span class="cart-item-price">${escapeHtml(linePrice)}</span>` : "<span></span>"}
        </li>
      `;
    })
    .join("");

  cartItemsEl.hidden = false;

  const subtotalText =
    structured.subtotalFormatted ??
    (structured.subtotal != null && structured.subtotal > 0
      ? structured.subtotal.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "");

  if (subtotalText) {
    cartSubtotal.textContent = subtotalText;
    cartFooter.hidden = false;
  } else {
    cartFooter.hidden = true;
  }

  document.title = `Your Bag (${itemCount})`;
}

function applyToolResult(result: CallToolResult) {
  if (result.isError) {
    const content = result.content ?? [];
    const textItem = content.find(
      (c): c is { type: "text"; text: string } => c.type === "text"
    );
    showError(textItem?.text ?? "An error occurred.");
    return;
  }

  const structured = getStructured(result);
  if (structured?.items?.length) {
    renderCart(structured);
    return;
  }

  // Host may send an empty follow-up result after tool-input already populated the view.
  if (hasRenderedItems) {
    setLoading(false);
    errorMessage.hidden = true;
    return;
  }

  showError("No cart data to display.");
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    mainEl.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

const app = new App({ name: "Shopping Cart App", version: "1.0.0" });

app.onteardown = async () => ({});
app.ontoolinput = (params) => {
  setLoading(true);
  pendingToolArgs = params?.arguments ?? null;
  const fromInput = structuredFromArgs(pendingToolArgs);
  if (fromInput?.items?.length) {
    renderCart(fromInput);
  }
};
app.ontoolresult = applyToolResult;
app.ontoolcancelled = () => showError("Request cancelled.");
app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
  if (!hasRenderedItems && cartItemsEl.hidden && errorMessage.hidden && emptyMessage.hidden) {
    setLoading(true);
  }
});
