/**
 * Product Detail MCP App — interactive UI for the `show-product-detail` tool.
 *
 * Data flow:
 * 1. Host invokes `show-product-detail` with a product object → `ontoolresult` renders PDP.
 * 2. User clicks Add to Bag → `app.sendMessage` prompts the host to call `show-cart`.
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
import "./product-detail.css";

type Product = {
  title?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  images?: string[];
  path?: string;
  link?: string;
  price?: string | number;
  currency?: string;
  badge?: string;
  rating?: string | number;
  reviews?: string | number;
  [key: string]: unknown;
};

type ToolStructured = {
  product?: Product;
  baseURL?: string;
};

const loaderEl = document.getElementById("loader")!;
const errorMessage = document.getElementById("error-message") as HTMLParagraphElement;
const contentEl = document.getElementById("pdp-content")!;
const galleryImage = document.getElementById("gallery-image") as HTMLImageElement;
const galleryDots = document.getElementById("gallery-dots")!;
const titleEl = document.getElementById("pdp-title")!;
const subtitleEl = document.getElementById("pdp-subtitle")!;
const priceEl = document.getElementById("pdp-price")!;
const vatEl = document.getElementById("pdp-vat")!;
const badgeEl = document.getElementById("pdp-badge")!;
const descriptionEl = document.getElementById("pdp-description")!;
const ratingEl = document.getElementById("pdp-rating")!;
const ratingValueEl = document.getElementById("pdp-rating-value")!;
const starsEl = document.getElementById("pdp-stars")!;
const reviewsEl = document.getElementById("pdp-reviews")!;
const reviewsLink = document.getElementById("pdp-reviews-link") as HTMLAnchorElement;
const qtyDec = document.getElementById("qty-dec") as HTMLButtonElement;
const qtyInc = document.getElementById("qty-inc") as HTMLButtonElement;
const qtyValue = document.getElementById("qty-value") as HTMLInputElement;
const addToBagBtn = document.getElementById("add-to-bag") as HTMLButtonElement;
const mainEl = document.querySelector(".main") as HTMLElement;

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect fill="#e2e8f0" width="400" height="400"/><text x="50%" y="50%" fill="#94a3b8" font-size="18" font-family="sans-serif" text-anchor="middle" dy=".3em">No image</text></svg>'
  );

let currentProduct: Product | null = null;
let galleryImages: string[] = [];
let activeImage = 0;
let quantity = 1;

function setLoading(loading: boolean) {
  loaderEl.hidden = !loading;
  loaderEl.setAttribute("aria-busy", loading ? "true" : "false");
  if (loading) {
    contentEl.hidden = true;
    errorMessage.hidden = true;
  }
}

function showError(message: string) {
  setLoading(false);
  contentEl.hidden = true;
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function formatPrice(product: Product): string {
  const { price, currency } = product;
  if (price == null || price === "") return "";
  const s = String(price).trim();
  // If the price already includes non-numeric formatting (currency), use as-is.
  if (/[^0-9.,\s]/.test(s)) return s;
  const num = Number(s.replace(/,/g, ""));
  if (Number.isNaN(num)) return s;
  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

function renderStars(rating: number): string {
  const full = Math.round(rating);
  let out = "";
  for (let i = 1; i <= 5; i += 1) {
    out += i <= full ? "★" : "☆";
  }
  return out;
}

function renderGallery() {
  if (galleryImages.length === 0) {
    galleryImage.src = PLACEHOLDER_IMAGE;
    galleryImage.alt = currentProduct?.title ?? "";
    galleryDots.innerHTML = "";
    return;
  }
  galleryImage.src = galleryImages[activeImage] || PLACEHOLDER_IMAGE;
  galleryImage.alt = currentProduct?.title ?? "";
  galleryImage.onerror = () => {
    galleryImage.onerror = null;
    galleryImage.src = PLACEHOLDER_IMAGE;
  };

  if (galleryImages.length <= 1) {
    galleryDots.innerHTML = "";
    return;
  }

  galleryDots.innerHTML = "";
  galleryImages.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "gallery-dot";
    dot.setAttribute("aria-label", `Show image ${index + 1} of ${galleryImages.length}`);
    dot.setAttribute("aria-current", index === activeImage ? "true" : "false");
    dot.addEventListener("click", () => {
      activeImage = index;
      renderGallery();
    });
    galleryDots.appendChild(dot);
  });
}

function renderProduct(product: Product) {
  currentProduct = product;
  galleryImages = (product.images && product.images.length > 0
    ? product.images
    : product.image
      ? [product.image]
      : []
  ).filter(Boolean);
  activeImage = 0;
  quantity = 1;
  qtyValue.value = "1";
  qtyDec.disabled = true;

  titleEl.textContent = product.title ?? "Untitled";
  document.title = product.title ?? "Product Detail";

  const subtitle = (product.subtitle ?? "").toString().trim();
  subtitleEl.textContent = subtitle;
  subtitleEl.hidden = !subtitle;

  const priceText = formatPrice(product);
  priceEl.textContent = priceText;
  vatEl.hidden = !priceText;

  const badge = (product.badge ?? "").toString().trim();
  badgeEl.textContent = badge;
  badgeEl.hidden = !badge;

  const description = (product.description ?? "").toString().trim();
  descriptionEl.textContent = description;
  descriptionEl.hidden = !description || !!subtitle && description === subtitle;

  const ratingNum = product.rating != null ? Number(product.rating) : NaN;
  if (!Number.isNaN(ratingNum) && ratingNum > 0) {
    ratingValueEl.textContent = ratingNum.toFixed(1);
    starsEl.textContent = renderStars(ratingNum);
    const reviewsNum = product.reviews != null ? Number(product.reviews) : NaN;
    reviewsEl.textContent = Number.isNaN(reviewsNum) ? "" : `(${reviewsNum})`;
    if (product.link) {
      reviewsLink.href = product.link;
      reviewsLink.hidden = false;
    } else {
      reviewsLink.hidden = true;
    }
    ratingEl.hidden = false;
  } else {
    ratingEl.hidden = true;
  }

  addToBagBtn.classList.remove("added");
  addToBagBtn.textContent = "ADD TO BAG";

  renderGallery();

  setLoading(false);
  errorMessage.hidden = true;
  contentEl.hidden = false;
}

function getStructured(result: CallToolResult): ToolStructured | null {
  if (result.isError) return null;
  return (result.structuredContent as ToolStructured | undefined) ?? null;
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
  if (structured?.product) {
    renderProduct(structured.product);
  } else {
    showError("No product data to display.");
  }
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

function updateQuantity(next: number) {
  quantity = Math.max(1, next);
  qtyValue.value = String(quantity);
  qtyDec.disabled = quantity <= 1;
}

/** MCP App client identity — sent to the host during `app.connect()` ui/initialize handshake */
const app = new App({ name: "Product Detail App", version: "1.0.0" });

/** MCP App lifecycle callbacks — see https://modelcontextprotocol.github.io/ext-apps/ */
app.onteardown = async () => ({});
app.ontoolinput = () => setLoading(true);
app.ontoolresult = applyToolResult;
app.ontoolcancelled = () => showError("Request cancelled.");
app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

qtyDec.addEventListener("click", () => updateQuantity(quantity - 1));
qtyInc.addEventListener("click", () => updateQuantity(quantity + 1));

addToBagBtn.addEventListener("click", async () => {
  if (!currentProduct) return;
  addToBagBtn.classList.add("added");
  addToBagBtn.textContent = "ADDED ✓";
  const title = currentProduct.title ?? "product";
  const lineItem = {
    product: currentProduct,
    quantity,
  };
  try {
    // Ask the host/model to invoke `show-cart` with the full conversation cart (when implemented)
    await app.sendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text:
            `Add ${quantity} × "${title}" to my bag and show the updated cart by calling the ` +
            `show-cart tool. Include every item previously added in this conversation plus this ` +
            `new line item in the items array: ${JSON.stringify(lineItem)}`,
        },
      ],
    });
  } catch (e) {
    console.error(e);
  }
  window.setTimeout(() => {
    addToBagBtn.classList.remove("added");
    addToBagBtn.textContent = "ADD TO BAG";
  }, 2000);
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
  // If the tool result arrived before connect resolved, ontoolresult already ran.
  if (contentEl.hidden && errorMessage.hidden) {
    setLoading(true);
  }
});
