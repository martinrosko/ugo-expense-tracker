export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

type Query = Record<string, string | number | boolean | undefined>

export type TokenProvider = () => string | Promise<string>

// Thin client for the Ugo backend; it forwards the caller's token so the backend enforces ownership
export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly getToken: TokenProvider) {}

  get<T = unknown>(path: string, query?: Query) { return this.request<T>('GET', path, { query }) }
  post<T = unknown>(path: string, body?: unknown) { return this.request<T>('POST', path, { body }) }
  patch<T = unknown>(path: string, body?: unknown) { return this.request<T>('PATCH', path, { body }) }
  put<T = unknown>(path: string, body?: unknown) { return this.request<T>('PUT', path, { body }) }
  delete(path: string) { return this.request<void>('DELETE', path) }

  async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown }
    const message = body.error ?? body.message
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON; fall through to the status text
  }
  return res.statusText || `HTTP ${res.status}`
}

export const seg = (id: string) => encodeURIComponent(id)
