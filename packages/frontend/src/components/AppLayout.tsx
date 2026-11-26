import React, { useEffect } from 'react'
import { Button, Layout, Menu, Typography } from 'antd'
import { CheckSquareOutlined, BankOutlined, BarChartOutlined, UnorderedListOutlined, TeamOutlined, FundOutlined, AreaChartOutlined, LineChartOutlined, LogoutOutlined, SettingOutlined, TagsOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import apiClient from '../api/apiClient'
import keycloak from '../auth/keycloak'

const { Header, Sider, Content } = Layout

interface AppLayoutProps {
  children: React.ReactNode
}

const NAV_ITEMS = [
  { key: '/plans', label: 'Plans Overview', icon: <BarChartOutlined /> },
  { key: '/transactions', label: 'Transactions', icon: <UnorderedListOutlined /> },
  { key: '/partners', label: 'Partner Balance', icon: <TeamOutlined /> },
  { key: '/budget-chart', label: 'Budget Chart', icon: <FundOutlined /> },
  { key: '/execution-chart', label: 'Plan Execution', icon: <LineChartOutlined /> },
  { key: '/account-balance', label: 'Account Balance', icon: <AreaChartOutlined /> },
  { key: '/review', label: 'Upload & Review', icon: <CheckSquareOutlined /> },
  {
    key: '/settings',
    label: 'Settings',
    icon: <SettingOutlined />,
    children: [
      { key: '/settings/tags', label: 'Tags', icon: <TagsOutlined /> },
      { key: '/settings/accounts', label: 'Accounts', icon: <BankOutlined /> },
      { key: '/settings/partners', label: 'Partner accounts', icon: <TeamOutlined /> },
    ],
  },
]

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()

  // Lets the server initialize the user's home timezone (used for plan status automation)
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    apiClient.get('/api/users/me', { params: { tz } }).catch(() => {})
  }, [])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ padding: '16px', color: '#fff', fontWeight: 700, fontSize: 16 }}>
          Ugo Expenses
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={location.pathname.startsWith('/settings') ? ['/settings'] : []}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Expense Tracker
          </Typography.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Typography.Text type="secondary">{String(keycloak.tokenParsed?.name ?? keycloak.tokenParsed?.preferred_username ?? '')}</Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={() => void keycloak.logout({ redirectUri: window.location.origin })}>Log out</Button>
          </div>
        </Header>
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
