import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ApiClient } from './apiClient.js'
import { requireToken, resourceMetadataUrl, type McpRequest } from './auth.js'
import { config } from './config.js'
import { createServer } from './server.js'

const app = express()
app.disable('x-powered-by')

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const metadata = {
  resource: `${config.publicUrl}/mcp`,
  authorization_servers: [config.keycloakIssuer],
  scopes_supported: config.scopes,
  bearer_methods_supported: ['header'],
}
app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => {
  res.json(metadata)
})

// Browsers can reach /mcp from foreign pages (DNS rebinding), so an Origin must be explicitly allowed
app.use('/mcp', (req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    if (!config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' })
      return
    }
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
      Vary: 'Origin',
    })
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

app.post('/mcp', requireToken, express.json({ limit: '1mb' }), async (req: McpRequest, res) => {
  const server = createServer(new ApiClient(config.backendUrl, () => req.token!))
  // Stateless: every request gets its own transport, so any replica can serve it
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error(err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
})

// Without sessions there is no server-initiated stream to open or session to close
app.all('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
})

app.listen(config.port, () => {
  console.log(`Ugo MCP server on :${config.port} (backend ${config.backendUrl}, metadata ${resourceMetadataUrl})`)
})
