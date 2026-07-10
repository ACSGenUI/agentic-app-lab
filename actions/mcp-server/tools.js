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
 * - show-products: fetches card data and renders the products carousel MCP App
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

const RESOURCE_URI = 'ui://show-products/product-list.html'

const argsSchema = z.object({
    keywords: z
        .string()
        .optional()
        .describe(
            'Full-text keywords to filter results; matches against title and description'
        )
})

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
    return { baseURL, dataEndpoint, resourceDomains, htmlPath }
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
}

/**
 * Register the MCP App UI resources.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} params
 */
function registerResources (server, params = {}) {
    const { baseURL, resourceDomains, htmlPath } = resolveConfig(params)
    const domains = buildResourceDomains(baseURL, resourceDomains)
    const cspMeta = {
        ui: {
            csp: {
                resourceDomains: domains.length > 0 ? domains : undefined
            }
        }
    }

    registerAppResource(
        server,
        RESOURCE_URI,
        RESOURCE_URI,
        { mimeType: RESOURCE_MIME_TYPE },
        async () => {
            const html = await loadUiHtml(htmlPath, 'productListHtml')
            return {
                contents: [
                    {
                        uri: RESOURCE_URI,
                        mimeType: RESOURCE_MIME_TYPE,
                        text: html,
                        _meta: cspMeta
                    }
                ]
            }
        }
    )
}

module.exports = {
    registerTools,
    registerResources,
    RESOURCE_URI
}
