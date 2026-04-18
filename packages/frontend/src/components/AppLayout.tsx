import React from 'react'
import { Layout, Menu, Typography } from 'antd'
import { UploadOutlined, CheckSquareOutlined, ApiOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'

const { Header, Sider, Content } = Layout

interface AppLayoutProps {
  children: React.ReactNode
}

const NAV_ITEMS = [
  { key: '/upload', label: 'Upload CSV', icon: <UploadOutlined /> },
  { key: '/review', label: 'Review & Submit', icon: <CheckSquareOutlined /> },
  { key: '/resco-test', label: 'Resco Test', icon: <ApiOutlined /> },
]

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()

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
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px' }}>
          <Typography.Title level={4} style={{ margin: 0, lineHeight: '64px' }}>
            Expense Tracker
          </Typography.Title>
        </Header>
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
