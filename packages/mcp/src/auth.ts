import type { NextFunction, Request, Response } from 'express'
import * as jose from 'jose'
import { config } from './config.js'

const jwks = jose.createRemoteJWKSet(new URL(config.keycloakJwksUri ?? `${config.keycloakIssuer}/protocol/openid-connect/certs`))

export const resourceMetadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource`

export interface McpRequest extends Request {
  token?: string
}

function unauthorized(res: Response, error?: string) {
  const params = [`resource_metadata="${resourceMetadataUrl}"`, `scope="${config.scopes.join(' ')}"`, ...(error ? [`error="${error}"`] : [])]
  res.status(401).set('WWW-Authenticate', `Bearer ${params.join(', ')}`).json({ error: 'unauthorized' })
}

// Verifies the Keycloak access token; the same token is then forwarded to the backend, which checks it again
export async function requireToken(req: McpRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return unauthorized(res)
  const token = header.slice(7)
  try {
    await jose.jwtVerify(token, jwks, { issuer: config.keycloakIssuer, ...(config.audience ? { audience: config.audience } : {}) })
  } catch {
    return unauthorized(res, 'invalid_token')
  }
  req.token = token
  next()
}
