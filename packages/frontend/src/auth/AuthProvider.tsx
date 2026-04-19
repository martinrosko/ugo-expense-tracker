import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import keycloak from './keycloak'

interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  token: string | undefined
  userEmail: string | undefined
  userName: string | undefined
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        pkceMethod: 'S256',
      })
      .then((authenticated) => {
        setIsAuthenticated(authenticated)
        setIsLoading(false)
      })
      .catch(() => setIsLoading(false))

    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).catch(() => {
        setIsAuthenticated(false)
      })
    }
  }, [])

  const login = () => keycloak.login()
  const logout = () => keycloak.logout({ redirectUri: window.location.origin })

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        token: keycloak.token,
        userEmail: keycloak.tokenParsed?.email as string | undefined,
        userName: keycloak.tokenParsed?.name as string | undefined,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
