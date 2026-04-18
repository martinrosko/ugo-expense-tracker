import type { Request, Response, NextFunction } from 'express'
import * as jose from 'jose'

const ISSUER = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/ugo'
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`

const jwks = jose.createRemoteJWKSet(new URL(JWKS_URI))

export interface AuthenticatedRequest extends Request {
  user?: jose.JWTPayload & {
    sub: string
    email?: string
    name?: string
    preferred_username?: string
  }
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }
  try {
    const token = header.slice(7)
    const { payload } = await jose.jwtVerify(token, jwks, { issuer: ISSUER })
    req.user = payload as AuthenticatedRequest['user']
    next()
  } catch {
    res.status(401).json({ error: 'Token verification failed' })
  }
}
