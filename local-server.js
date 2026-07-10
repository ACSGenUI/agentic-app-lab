/**
 * Local development server for the MCP action.
 * Translates HTTP requests into the OpenWhisk params format that main() expects.
 *
 * Usage: node local-server.js [port]
 *
 * Loads variables from .env in the project root (baseURL, dataEndpoint, etc.).
 */

require('dotenv').config()

const http = require('http')
const { main } = require('./actions/mcp-server/index.js')

const PORT = parseInt(process.argv[2] || process.env.PORT || '9080', 10)

const server = http.createServer(async (req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
        const rawBody = Buffer.concat(chunks)

        const params = {
            __ow_method: req.method.toLowerCase(),
            __ow_headers: req.headers,
            __ow_path: req.url,
            LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
            baseURL: process.env.baseURL || process.env.BASE_URL,
            dataEndpoint: process.env.dataEndpoint || process.env.DATA_ENDPOINT,
            RESOURCE_DOMAINS: process.env.RESOURCE_DOMAINS,
            SERVICE_API_KEY: process.env.SERVICE_API_KEY,
            AUTH_VALIDATE_IMS: process.env.AUTH_VALIDATE_IMS
        }

        if (rawBody.length > 0) {
            params.__ow_body = rawBody.toString('base64')
        }

        const url = new URL(req.url, `http://localhost:${PORT}`)
        url.searchParams.forEach((value, key) => { params[key] = value })

        try {
            const result = await main(params)
            const statusCode = result.statusCode || 200
            const headers = result.headers || {}

            res.writeHead(statusCode, headers)

            if (result.body) {
                const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
                res.end(body)
            } else {
                res.end()
            }
        } catch (err) {
            console.error('Error calling main():', err)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
        }
    })
})

server.listen(PORT, () => {
    const dataEndpoint = process.env.dataEndpoint || process.env.DATA_ENDPOINT
    const baseURL = process.env.baseURL || process.env.BASE_URL
    console.log(`MCP local server running at http://localhost:${PORT}`)
    console.log(`Health check: curl http://localhost:${PORT}`)
    console.log(`MCP endpoint: http://localhost:${PORT}`)
    if (!dataEndpoint) {
        console.warn('Warning: dataEndpoint is not set. Add it to .env or the tool will fail.')
    } else {
        console.log(`dataEndpoint: ${dataEndpoint}`)
    }
    if (baseURL) {
        console.log(`baseURL: ${baseURL}`)
    }
})
