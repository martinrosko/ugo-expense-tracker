import { type ReactNode } from 'react'
import { Button, Result, Spin } from 'antd'
import { useAuth } from '../auth/AuthProvider'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, login } = useAuth()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" description="Checking authentication..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Result
        status="403"
        title="Please sign in"
        subTitle="You need to sign in to use Ugo Finance."
        extra={
          <Button type="primary" size="large" onClick={login}>
            Sign in with Keycloak
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}
