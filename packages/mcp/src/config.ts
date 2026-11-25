const env = process.env

export const config = {
  port: Number(env.PORT ?? 3001),
  backendUrl: (env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  // Must equal the `iss` claim of the tokens Keycloak issues, i.e. the URL clients reach Keycloak on
  keycloakIssuer: (env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/ugo').replace(/\/+$/, ''),
  // Lets the server fetch keys over an internal address while the issuer is a public one
  keycloakJwksUri: env.KEYCLOAK_JWKS_URI,
  // Public base URL of this server as MCP clients see it (behind a proxy this is the proxy's URL)
  publicUrl: (env.MCP_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3001}`).replace(/\/+$/, ''),
  // Enforced only when set: Keycloak adds the claim through an audience mapper on the client
  audience: env.MCP_AUDIENCE || undefined,
  // Without this, clients ask for every scope Keycloak lists and fail on those the client may not use; the backend needs email and name
  scopes: (env.MCP_SCOPES ?? 'openid profile email').split(/[\s,]+/).filter(Boolean),
  // Comma-separated Origin values allowed to call /mcp from a browser; requests without Origin are always accepted
  allowedOrigins: (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  // stdio mode only
  accessToken: env.UGO_ACCESS_TOKEN,
  refreshToken: env.UGO_REFRESH_TOKEN,
  keycloakClientId: env.KEYCLOAK_CLIENT_ID ?? 'ugo-mcp',
}
