import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ApiClient } from './apiClient.js'
import { config } from './config.js'
import { createServer } from './server.js'
import { stdioTokenProvider } from './tokenProvider.js'

// stdout carries the protocol, so diagnostics go to stderr
async function main() {
  const server = createServer(new ApiClient(config.backendUrl, stdioTokenProvider()))
  await server.connect(new StdioServerTransport())
  console.error('Ugo MCP server running on stdio')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
