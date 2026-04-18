import { useState } from 'react'
import { Button, Card, Typography, Space, Spin, Alert, Tag } from 'antd'
import { ApiOutlined } from '@ant-design/icons'
import rescoClient from '../api/rescoClient'

const { Title, Text } = Typography

const ENTITIES = [
  { name: 'rw_account', label: 'Accounts' },
  { name: 'rw_bankticket', label: 'Bank Tickets' },
  { name: 'rw_budget', label: 'Budgets' },
  { name: 'rw_plan', label: 'Plans' },
  { name: 'rw_transaction', label: 'Transactions' },
  { name: 'rw_tag', label: 'Tags' },
  { name: 'rw_transactiontag', label: 'Transaction Tags' },
]

type EntityState = {
  loading: boolean
  data: unknown[] | null
  error: string | null
}

const initialState: Record<string, EntityState> = Object.fromEntries(
  ENTITIES.map((e) => [e.name, { loading: false, data: null, error: null }]),
)

export default function RescoTestPage() {
  const [states, setStates] = useState<Record<string, EntityState>>(initialState)

  function setEntityState(name: string, patch: Partial<EntityState>) {
    setStates((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  async function loadEntity(entityName: string) {
    setEntityState(entityName, { loading: true, data: null, error: null })
    try {
      const res = await rescoClient.get<{ value: unknown[] }>(`/${entityName}`, {
        params: { $top: 5 },
      })
      setEntityState(entityName, { loading: false, data: res.data.value })
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Request failed'
      setEntityState(entityName, { loading: false, error: msg })
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Space>
        <ApiOutlined style={{ fontSize: 24 }} />
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Resco OData — Entity Test
          </Title>
          <Text type="secondary">
            org: <Text code>rohelbb</Text> · base:{' '}
            <Text code>https://rohelbb.rescocrm.com/odata/v4/</Text>
          </Text>
        </div>
      </Space>

      {ENTITIES.map(({ name, label }) => {
        const state = states[name]
        const recordCount = state.data?.length ?? 0

        return (
          <Card
            key={name}
            title={
              <Space>
                {label}
                {state.data !== null && (
                  <Tag color="blue">{recordCount} record{recordCount !== 1 ? 's' : ''}</Tag>
                )}
              </Space>
            }
            extra={
              <Space>
                <Text type="secondary" code style={{ fontSize: 12 }}>
                  {name}
                </Text>
                <Button
                  type="primary"
                  size="small"
                  loading={state.loading}
                  onClick={() => loadEntity(name)}
                >
                  Load 5
                </Button>
              </Space>
            }
          >
            {state.loading && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching from Resco…" />
              </div>
            )}
            {state.error && (
              <Alert type="error" showIcon message="Request failed" description={state.error} />
            )}
            {state.data !== null && !state.loading && (
              state.data.length === 0 ? (
                <Text type="secondary">No records found.</Text>
              ) : (
                <pre
                  style={{
                    background: '#f6f8fa',
                    border: '1px solid #e8e8e8',
                    borderRadius: 4,
                    padding: 12,
                    overflow: 'auto',
                    maxHeight: 320,
                    fontSize: 12,
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {JSON.stringify(state.data, null, 2)}
                </pre>
              )
            )}
            {!state.loading && !state.error && state.data === null && (
              <Text type="secondary">Click "Load 5" to fetch records on demand.</Text>
            )}
          </Card>
        )
      })}
    </Space>
  )
}
