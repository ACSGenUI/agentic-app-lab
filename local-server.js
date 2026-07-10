/**
 * Local development server for the MCP action.
 * Translates HTTP requests into the OpenWhisk params format that main() expects.
 *
 * Usage: node local-server.js [port]
 *
 * Project root: MCP clients using `transport: "StreamableHTTP"` + `url` typically do **not**
 * inject `env.UI_AUDIT_PROJECT_ROOT` into this Node process (that `env` applies to stdio-spawned servers).
 * Set the variable when you start the server, e.g.:
 *   UI_AUDIT_PROJECT_ROOT=/path/to/repo node local-server.js
 * Or send header `X-UI-Audit-Project-Root` on each request (see actions/mcp-server/lib/config.js).
 */

const http = require('http')
const { main } = require('./actions/mcp-server/index.js')

const PORT = parseInt(process.argv[2] || process.env.PORT || '9080', 10)

const server = http.createServer(async (req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
        const rawBody = Buffer.concat(chunks)

        // Build OpenWhisk-style params
        const params = {
            __ow_method: req.method.toLowerCase(),
            __ow_headers: req.headers,
            __ow_path: req.url,
            LOG_LEVEL: process.env.LOG_LEVEL || 'debug'
        }

        if (rawBody.length > 0) {
            params.__ow_body = rawBody.toString('base64')
        }

        // Copy query params as top-level params
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
    console.log(`MCP local server running at http://localhost:${PORT}`)
    console.log(`Health check: curl http://localhost:${PORT}`)
    console.log(`MCP endpoint: http://localhost:${PORT}`)
})
