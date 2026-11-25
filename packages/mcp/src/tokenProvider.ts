import * as jose from 'jose'
import type { TokenProvider } from './apiClient.js'
import { config } from './config.js'

// stdio cannot run an OAuth flow, so the token comes from the environment
export function stdioTokenProvider(): TokenProvider {
  const { accessToken, refreshToken: initialRefreshToken, keycloakIssuer, keycloakClientId } = config
  if (!initialRefreshToken) {
    if (!accessToken) throw new Error('Set UGO_ACCESS_TOKEN, or UGO_REFRESH_TOKEN to let the server renew the token itself.')
    return () => accessToken
  }

  let refreshToken = initialRefreshToken
  let current = ''
  let expiresAt = 0

  return async () => {
    if (current && Date.now() < expiresAt - 30_000) return current
    const res = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: keycloakClientId, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Keycloak refused to refresh the token (HTTP ${res.status}). Get a new UGO_REFRESH_TOKEN.`)
    const body = (await res.json()) as { access_token: string; refresh_token?: string }
    current = body.access_token
    // Keycloak may rotate the refresh token; keep the newest one for the next renewal
    if (body.refresh_token) refreshToken = body.refresh_token
    expiresAt = (jose.decodeJwt(current).exp ?? 0) * 1000
    return current
  }
}
