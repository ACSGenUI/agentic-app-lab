/*
Copyright 2022 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

/**
 * MCP Server tools and resources for the Product List MCP App.
 *
 * Tools:
 * - show-products: fetches card data and renders the product-list MCP App
 * - show-product-detail: renders a single product detail view MCP App
 * - show-cart: renders the shopping cart with all items added in the conversation
 *
 * Resources:
 * - ui://show-products/product-list.html
 * - ui://show-product-detail/product-detail.html
 * - ui://show-cart/cart.html
 */

const fs = require('fs/promises')
const path = require('path')
const { z } = require('zod')
const {
    registerAppResource,
    registerAppTool,
    RESOURCE_MIME_TYPE
} = require('@modelcontextprotocol/ext-apps/server')

/** Inlined HTML from npm run embed:ui (required for Adobe I/O Runtime deploy). */
let embeddedUi = null
try {
    embeddedUi = require('./embedded-ui.js')
} catch {
    // Local dev without embed step — falls back to reading actions/mcp-server/static/
}

/** URI linked from show-products via _meta.ui.resourceUri */
const RESOURCE_URI = 'ui://show-products/product-list.html'
/** URI linked from show-product-detail via _meta.ui.resourceUri */
const PRODUCT_DETAIL_RESOURCE_URI = 'ui://show-product-detail/product-detail.html'
/** URI linked from show-cart via _meta.ui.resourceUri */
const CART_RESOURCE_URI = 'ui://show-cart/cart.html'

const argsSchema = z.object({
    keywords: z
        .string()
        .optional()
        .describe(
            'Full-text keywords to filter results; matches against title and description'
        )
})

const productSchema = z
    .object({
        title: z.string().describe('Product title'),
        subtitle: z.string().optional().describe('Short subtitle, e.g. "Gift Set"'),
        description: z.string().optional().describe('Product description'),
        image: z.string().optional().describe('Primary image URL or path'),
        images: z
            .array(z.string())
            .optional()
            .describe('Additional image URLs or paths for the gallery'),
        path: z.string().optional().describe('Link path to the product page'),
        price: z
            .union([z.string(), z.number()])
            .optional()
            .describe('Price value, e.g. 300 or "QAR 300.00"'),
        currency: z.string().optional().describe('Currency code/symbol, e.g. "QAR"'),
        badge: z.string().optional().describe('Promotional badge, e.g. "Buy 2 Get 1 Free"'),
        rating: z
            .union([z.string(), z.number()])
            .optional()
            .describe('Average rating (0-5)'),
        reviews: z
            .union([z.string(), z.number()])
            .optional()
            .describe('Number of reviews')
    })
    .passthrough()

const cartItemSchema = z.object({
    product: productSchema,
    quantity: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe('Quantity of this product in the cart')
})

const cartArgsSchema = z.object({
    items: z
        .array(cartItemSchema)
        .min(1)
        .describe(
            'All cart line items for this conversation. When adding a product, include every item previously added plus the new line.'
        )
})

function cartItemKey (product) {
    const path = product.path ?? product.link
    if (path) return String(path)
    if (product.title) return String(product.title)
    return JSON.stringify(product)
}

function parseUnitPrice (product) {
    const { price } = product
    if (price == null || price === '') return 0
    const s = String(price).trim()
    const numeric = s.replace(/[^0-9.,]/g, '').replace(/,/g, '')
    const num = Number(numeric)
    return Number.isNaN(num) ? 0 : num
}

function formatMoney (amount, currency) {
    const formatted = amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })
    return currency ? `${currency} ${formatted}` : formatted
}

/** Merge duplicate products and normalize URLs for cart display. */
function buildCartItems (items, baseURL) {
    const merged = new Map()
    for (const entry of items) {
        const product = normalizeProduct(entry.product, baseURL)
        const quantity = Math.max(1, Math.floor(entry.quantity ?? 1))
        const key = cartItemKey(product)
        const existing = merged.get(key)
        if (existing) {
            existing.quantity += quantity
        } else {
            merged.set(key, { product, quantity })
        }
    }
    return Array.from(merged.values())
}

function summarizeCart (items) {
    let subtotal = 0
    let currency
    let itemCount = 0
    for (const { product, quantity } of items) {
        subtotal += parseUnitPrice(product) * quantity
        itemCount += quantity
        if (!currency && product.currency) {
            currency = String(product.currency)
        }
    }
    return { subtotal, currency, itemCount }
}

function matchesKeywords (row, keywords) {
    const title = String(row.title ?? '').toLowerCase()
    const description = String(row.description ?? '').toLowerCase()
    const terms = keywords
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    if (terms.length === 0) return true
    const combined = `${title} ${description}`
    return terms.every((term) => combined.includes(term))
}

async function fetchSheetData (endpoint) {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`)
    }
    const json = await res.json()
    if (!Array.isArray(json.data)) {
        throw new Error("Response must have a 'data' array")
    }
    return json
}

/** Resolve a possibly-relative URL/path against the configured baseURL. */
function resolveUrl (value, baseURL) {
    if (value == null || value === '') return ''
    const s = String(value).trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    const pathPart = s.startsWith('/') ? s : `/${s}`
    if (baseURL && baseURL.trim()) {
        return `${baseURL.replace(/\/$/, '')}${pathPart}`
    }
    return pathPart
}

/** Normalize a product object: resolve image/link URLs and build a gallery list. */
function normalizeProduct (product, baseURL) {
    const primaryImage = resolveUrl(
        product.image ?? product.thumbnail ?? product.imageUrl ?? product.img,
        baseURL
    )
    const gallery = Array.isArray(product.images)
        ? product.images.map((img) => resolveUrl(img, baseURL)).filter(Boolean)
        : []
    if (primaryImage && !gallery.includes(primaryImage)) {
        gallery.unshift(primaryImage)
    }
    return {
        ...product,
        image: primaryImage || undefined,
        images: gallery,
        link: resolveUrl(product.path, baseURL) || undefined
    }
}

function buildResourceDomains (baseURL, extraDomains) {
    const resourceDomains = []
    try {
        if (baseURL?.trim()) {
            resourceDomains.push(new URL(baseURL).origin)
        }
    } catch {
        // ignore invalid baseURL
    }
    if (typeof extraDomains === 'string' && extraDomains.trim()) {
        for (const d of extraDomains.split(',')) {
            const origin = d.trim()
            if (origin && !resourceDomains.includes(origin)) {
                try {
                    resourceDomains.push(new URL(origin).origin)
                } catch {
                    resourceDomains.push(origin)
                }
            }
        }
    }
    if (!resourceDomains.includes('https://bbwqa-pprod.factory.alshayauat.com')) {
        resourceDomains.push('https://bbwqa-pprod.factory.alshayauat.com')
    }
    return resourceDomains
}

let actionConfig = {}
try {
    actionConfig = require('./action-config.js')
} catch (_) {
    // Local dev / tests without embed:config
}

function resolveConfig (params = {}) {
    const baseURL = String(
        params.baseURL ??
            params.BASE_URL ??
            actionConfig.baseURL ??
            actionConfig.BASE_URL ??
            ''
    ).trim()
    const dataEndpoint = String(
        params.dataEndpoint ??
            params.DATA_ENDPOINT ??
            actionConfig.dataEndpoint ??
            actionConfig.DATA_ENDPOINT ??
            ''
    ).trim()
    const resourceDomains =
        params.RESOURCE_DOMAINS ?? actionConfig.RESOURCE_DOMAINS
    const staticDir = params.__staticDir || path.join(__dirname, 'static')
    const htmlPath = params.__productListHtmlPath || path.join(staticDir, 'product-list.html')
    const detailHtmlPath =
        params.__productDetailHtmlPath || path.join(staticDir, 'product-detail.html')
    const cartHtmlPath = params.__cartHtmlPath || path.join(staticDir, 'cart.html')
    return { baseURL, dataEndpoint, resourceDomains, htmlPath, detailHtmlPath, cartHtmlPath }
}

async function loadUiHtml (filePath, embeddedKey) {
    const embedded = embeddedUi?.[embeddedKey]
    if (typeof embedded === 'string' && embedded.length > 0) {
        return embedded
    }
    return fs.readFile(filePath, 'utf-8')
}

/**
 * Register the MCP App tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} params
 */
function registerTools (server, params = {}) {
    const { baseURL, dataEndpoint } = resolveConfig(params)

    registerAppTool(
        server,
        'show-products',
        {
            title: 'Show Products',
            description:
                'Displays list of cards (title, description, image, link) from the configured data endpoint. Optionally pass keywords to filter by title and description.',
            inputSchema: {
                keywords: z
                    .string()
                    .optional()
                    .describe(
                        'Filter results by matching these keywords against title and description'
                    )
            },
            outputSchema: {
                data: z.array(z.record(z.union([z.string(), z.number()]))),
                columns: z.array(z.string()),
                total: z.number(),
                baseURL: z.string().optional()
            },
            _meta: { ui: { resourceUri: RESOURCE_URI } }
        },
        async (args) => {
            const parsed = argsSchema.safeParse(args ?? {})
            if (!parsed.success) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Invalid arguments: ${parsed.error.message}`
                        }
                    ],
                    isError: true
                }
            }

            if (!dataEndpoint) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Missing dataEndpoint. Set dataEndpoint in the action inputs to the REST endpoint URL that returns { columns, data }.'
                        }
                    ],
                    isError: true
                }
            }

            const { keywords } = parsed.data
            try {
                const sheet = await fetchSheetData(dataEndpoint)
                let data = sheet.data
                if (keywords?.trim()) {
                    data = data.filter((row) => matchesKeywords(row, keywords))
                }
                const total = data.length
                const text = keywords?.trim()
                    ? `Filtered to ${total} cards matching "${keywords}".`
                    : `Showing ${total} cards.`
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        data,
                        columns: sheet.columns ?? [],
                        total,
                        baseURL: baseURL || undefined
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    content: [{ type: 'text', text: `Error: ${message}` }],
                    isError: true
                }
            }
        }
    )

    registerAppTool(
        server,
        'show-product-detail',
        {
            title: 'Show Product Detail',
            description:
                'Renders a detailed product view (image gallery, title, subtitle, price, promotional badge, rating, quantity selector, and add-to-bag) for a single card. Pass the card/product object (title, description, image, path, price, badge, rating, reviews). Typically invoked when a user clicks a card in the product list.',
            inputSchema: {
                product: productSchema.describe(
                    'The product/card object to render in the detail view'
                )
            },
            outputSchema: {
                product: z.record(z.any()),
                baseURL: z.string().optional()
            },
            _meta: { ui: { resourceUri: PRODUCT_DETAIL_RESOURCE_URI } }
        },
        async (args) => {
            const parsed = z
                .object({ product: productSchema })
                .safeParse(args ?? {})
            if (!parsed.success) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Invalid arguments: ${parsed.error.message}`
                        }
                    ],
                    isError: true
                }
            }

            const product = normalizeProduct(parsed.data.product, baseURL)
            return {
                content: [
                    {
                        type: 'text',
                        text: `Showing product detail for "${product.title}".`
                    }
                ],
                structuredContent: {
                    product,
                    baseURL: baseURL || undefined
                }
            }
        }
    )

    registerAppTool(
        server,
        'show-cart',
        {
            title: 'Show Cart',
            description:
                'Displays the shopping cart with all items added during this conversation. Pass the full items array (product + quantity per line). When a user adds to bag from product detail, merge any prior cart items with the new line so the cart reflects everything added so far.',
            inputSchema: {
                items: z
                    .array(cartItemSchema)
                    .min(1)
                    .describe(
                        'All cart line items for this conversation, including previously added products'
                    )
            },
            outputSchema: {
                items: z.array(
                    z.object({
                        product: z.record(z.any()),
                        quantity: z.number()
                    })
                ),
                itemCount: z.number(),
                subtotal: z.number(),
                subtotalFormatted: z.string().optional(),
                currency: z.string().optional(),
                baseURL: z.string().optional()
            },
            _meta: { ui: { resourceUri: CART_RESOURCE_URI } }
        },
        async (args) => {
            const parsed = cartArgsSchema.safeParse(args ?? {})
            if (!parsed.success) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Invalid arguments: ${parsed.error.message}`
                        }
                    ],
                    isError: true
                }
            }

            const items = buildCartItems(parsed.data.items, baseURL)
            const { subtotal, currency, itemCount } = summarizeCart(items)
            const subtotalFormatted =
                subtotal > 0 ? formatMoney(subtotal, currency) : undefined
            const summary =
                itemCount === 1
                    ? 'Your cart has 1 item.'
                    : `Your cart has ${itemCount} items.`

            return {
                content: [
                    {
                        type: 'text',
                        text: subtotalFormatted
                            ? `${summary} Subtotal: ${subtotalFormatted}.`
                            : summary
                    }
                ],
                structuredContent: {
                    items,
                    itemCount,
                    subtotal,
                    subtotalFormatted,
                    currency: currency || undefined,
                    baseURL: baseURL || undefined
                }
            }
        }
    )
}

/**
 * Register the MCP App UI resources.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} params
 */
function registerResources (server, params = {}) {
    const { baseURL, resourceDomains, htmlPath, detailHtmlPath, cartHtmlPath } =
        resolveConfig(params)
    const domains = buildResourceDomains(baseURL, resourceDomains)
    const cspMeta = {
        ui: {
            csp: {
                resourceDomains: domains.length > 0 ? domains : undefined
            }
        }
    }

    const makeResource = (uri, filePath, embeddedKey) =>
        registerAppResource(
            server,
            uri,
            uri,
            { mimeType: RESOURCE_MIME_TYPE },
            async () => {
                const html = await loadUiHtml(filePath, embeddedKey)
                return {
                    contents: [
                        {
                            uri,
                            mimeType: RESOURCE_MIME_TYPE,
                            text: html,
                            _meta: cspMeta
                        }
                    ]
                }
            }
        )

    makeResource(RESOURCE_URI, htmlPath, 'productListHtml')
    makeResource(PRODUCT_DETAIL_RESOURCE_URI, detailHtmlPath, 'productDetailHtml')
    makeResource(CART_RESOURCE_URI, cartHtmlPath, 'cartHtml')
}

module.exports = {
    registerTools,
    registerResources,
    RESOURCE_URI,
    PRODUCT_DETAIL_RESOURCE_URI,
    CART_RESOURCE_URI
}
