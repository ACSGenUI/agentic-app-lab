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
 * Test suite for Product List MCP Server on Adobe I/O Runtime
 */

jest.mock('../actions/mcp-server/action-config.js', () => ({}))

const { main } = require('../actions/mcp-server/index.js')

const TEST_DATA_ENDPOINT = 'https://example.com/query-index.json'
const TEST_BASE_URL = 'https://example.com'

const mockSheet = {
    columns: ['title', 'description', 'image', 'path'],
    data: [
        {
            title: 'Summer Sale',
            description: 'Great deals on seasonal items',
            image: 'https://example.com/sale.jpg',
            path: '/sale'
        },
        {
            title: 'Winter Collection',
            description: 'Cozy products for cold weather',
            image: 'https://example.com/winter.jpg',
            path: '/winter'
        }
    ]
}

function baseParams (overrides = {}) {
    return {
        LOG_LEVEL: 'info',
        baseURL: TEST_BASE_URL,
        dataEndpoint: TEST_DATA_ENDPOINT,
        ...overrides
    }
}

describe('Product List MCP Server Tests', () => {
    beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => mockSheet
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('Health Check', () => {
        test('should respond to GET request with health status', async () => {
            const result = await main({
                __ow_method: 'get',
                __ow_path: '/',
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)
            expect(result.headers['Content-Type']).toBe('application/json')

            const body = JSON.parse(result.body)
            expect(body.status).toBe('healthy')
            expect(body.server).toBe('sselvara-agentic-app')
            expect(body.version).toBe('1.0.0')
        })
    })

    describe('CORS Support', () => {
        test('should handle OPTIONS request for CORS preflight', async () => {
            const result = await main({
                __ow_method: 'options',
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)
            expect(result.headers['Access-Control-Allow-Origin']).toBe('*')
            expect(result.headers['Access-Control-Allow-Methods']).toContain('POST')
        })
    })

    describe('MCP Protocol', () => {
        test('should handle initialize request', async () => {
            const initRequest = {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                        name: 'test-client',
                        version: '1.0.0'
                    }
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(initRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.jsonrpc).toBe('2.0')
            expect(body.id).toBe(1)
            expect(body.result.protocolVersion).toBe('2024-11-05')
            expect(body.result.serverInfo.name).toBe('sselvara-agentic-app')
        })

        test('should list show-products, show-product-detail, and show-cart tools', async () => {
            const toolsListRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolsListRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            const toolNames = body.result.tools.map((tool) => tool.name)
            expect(toolNames).toEqual(
                expect.arrayContaining(['show-products', 'show-product-detail', 'show-cart'])
            )
            expect(toolNames).toHaveLength(3)
            expect(toolNames).not.toContain('echo')
            expect(toolNames).not.toContain('calculator')
            expect(toolNames).not.toContain('weather')

            const productsTool = body.result.tools.find(
                (tool) => tool.name === 'show-products'
            )
            expect(productsTool).toBeDefined()
            expect(productsTool.description).toContain('cards')

            const detailTool = body.result.tools.find(
                (tool) => tool.name === 'show-product-detail'
            )
            expect(detailTool).toBeDefined()
            expect(detailTool.description).toContain('detailed product view')

            const cartTool = body.result.tools.find((tool) => tool.name === 'show-cart')
            expect(cartTool).toBeDefined()
            expect(cartTool.description).toContain('cart')
        })

        test('should call show-product-detail tool and return normalized product', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 20,
                method: 'tools/call',
                params: {
                    name: 'show-product-detail',
                    arguments: {
                        product: {
                            title: 'Japanese Cherry Blossom',
                            subtitle: 'Gift Set',
                            image: '/images/jcb.jpg',
                            path: '/products/jcb',
                            price: 300,
                            currency: 'QAR',
                            badge: 'Buy 2 Get 1 Free',
                            rating: 4.8,
                            reviews: 6
                        }
                    }
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.result.content[0].text).toContain('Japanese Cherry Blossom')
            const product = body.result.structuredContent.product
            expect(product.title).toBe('Japanese Cherry Blossom')
            expect(product.image).toBe(`${TEST_BASE_URL}/images/jcb.jpg`)
            expect(product.link).toBe(`${TEST_BASE_URL}/products/jcb`)
            expect(product.images).toContain(`${TEST_BASE_URL}/images/jcb.jpg`)
        })

        test('should call show-products tool and return structured content', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'show-products',
                    arguments: {}
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.jsonrpc).toBe('2.0')
            expect(body.id).toBe(3)
            expect(body.result.content[0].text).toContain('Showing 2 cards')
            expect(body.result.structuredContent.total).toBe(2)
            expect(body.result.structuredContent.baseURL).toBe(TEST_BASE_URL)
            expect(global.fetch).toHaveBeenCalledWith(
                TEST_DATA_ENDPOINT,
                expect.objectContaining({ headers: { Accept: 'application/json' } })
            )
        })

        test('should filter cards by keywords', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: {
                    name: 'show-products',
                    arguments: { keywords: 'winter' }
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.result.content[0].text).toContain('Filtered to 1 cards')
            expect(body.result.structuredContent.total).toBe(1)
            expect(body.result.structuredContent.data[0].title).toBe('Winter Collection')
        })

        test('should return error when dataEndpoint is missing', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 5,
                method: 'tools/call',
                params: {
                    name: 'show-products',
                    arguments: {}
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                LOG_LEVEL: 'info'
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.result.isError).toBe(true)
            expect(body.result.content[0].text).toContain('Missing dataEndpoint')
        })

        test('should call show-cart tool and return merged cart items', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 21,
                method: 'tools/call',
                params: {
                    name: 'show-cart',
                    arguments: {
                        items: [
                            {
                                product: {
                                    title: 'Japanese Cherry Blossom',
                                    image: '/images/jcb.jpg',
                                    path: '/products/jcb',
                                    price: 300,
                                    currency: 'QAR'
                                },
                                quantity: 1
                            },
                            {
                                product: {
                                    title: 'Japanese Cherry Blossom',
                                    image: '/images/jcb.jpg',
                                    path: '/products/jcb',
                                    price: 300,
                                    currency: 'QAR'
                                },
                                quantity: 2
                            }
                        ]
                    }
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.result.content[0].text).toContain('3 items')
            expect(body.result.structuredContent.itemCount).toBe(3)
            expect(body.result.structuredContent.items).toHaveLength(1)
            expect(body.result.structuredContent.items[0].quantity).toBe(3)
            expect(body.result.structuredContent.subtotal).toBe(900)
        })

        test('should list product-list, product-detail, and cart UI resources', async () => {
            const resourcesListRequest = {
                jsonrpc: '2.0',
                id: 6,
                method: 'resources/list',
                params: {}
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(resourcesListRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(Array.isArray(body.result.resources)).toBe(true)
            expect(body.result.resources).toHaveLength(3)

            const listResource = body.result.resources.find(
                (r) => r.uri === 'ui://show-products/product-list.html'
            )
            expect(listResource).toBeDefined()

            const detailResource = body.result.resources.find(
                (r) => r.uri === 'ui://show-product-detail/product-detail.html'
            )
            expect(detailResource).toBeDefined()

            const cartResource = body.result.resources.find(
                (r) => r.uri === 'ui://show-cart/cart.html'
            )
            expect(cartResource).toBeDefined()
        })
    })

    describe('Error Handling', () => {
        test('should handle invalid JSON-RPC request', async () => {
            const result = await main({
                __ow_method: 'post',
                __ow_body: 'invalid json',
                ...baseParams()
            })

            expect(result.statusCode).toBe(500)

            const body = JSON.parse(result.body)
            expect(body.jsonrpc).toBe('2.0')
            expect(body.error).toBeDefined()
        })

        test('should return error for unknown tool call', async () => {
            const toolCallRequest = {
                jsonrpc: '2.0',
                id: 8,
                method: 'tools/call',
                params: {
                    name: 'nonexistent_tool',
                    arguments: {}
                }
            }

            const result = await main({
                __ow_method: 'post',
                __ow_body: JSON.stringify(toolCallRequest),
                ...baseParams()
            })

            expect(result.statusCode).toBe(200)

            const body = JSON.parse(result.body)
            expect(body.result.isError).toBe(true)
            expect(body.result.content[0].text).toContain('not found')
        })

        test('should handle unsupported HTTP method', async () => {
            const result = await main({
                __ow_method: 'put',
                ...baseParams()
            })

            expect(result.statusCode).toBe(405)
        })
    })
})
