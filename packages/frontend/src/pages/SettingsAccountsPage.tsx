import { useCallback, useEffect, useState } from 'react'
import { App as AntApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'
import { apiError } from '../features/planTransactions'

const { Title, Paragraph } = Typography

type OwnAccount = { id: string; name: string; type: string; isOwner: boolean }
type CoOwner = { userId: string; email: string; name: string }

const ASSET_TYPES = ['CASH', 'BANK', 'INVESTMENT']

type NewAccount = { name: string; type: string; initialBalance?: number }

export default function SettingsAccountsPage() {
  const { message } = AntApp.useApp()
  const [accounts, setAccounts] = useState<OwnAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState<OwnAccount | null>(null)
  const [coOwners, setCoOwners] = useState<CoOwner[]>([])
  const [email, setEmail] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<NewAccount>()

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<OwnAccount[]>('/api/accounts')
      setAccounts(res.data.filter((a) => ASSET_TYPES.includes(a.type)))
    } catch (err) {
      message.error(apiError(err, 'Failed to load accounts'))
    } finally {
      setLoading(false)
    }
  }, [message])

  const loadCoOwners = useCallback(async (account: OwnAccount) => {
    try {
      setCoOwners((await apiClient.get<CoOwner[]>(`/api/accounts/${account.id}/co-owners`)).data)
    } catch (err) {
      message.error(apiError(err, 'Failed to load co-owners'))
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setEmail('')
    if (sharing) void loadCoOwners(sharing)
  }, [sharing, loadCoOwners])

  async function createAccount() {
    const values = await createForm.validateFields()
    setCreating(true)
    try {
      await apiClient.post('/api/accounts', { name: values.name.trim(), type: values.type, initialBalance: values.initialBalance ?? 0 })
      setCreateOpen(false)
      message.success('Account created')
      await load()
    } catch (err) {
      message.error(apiError(err, 'Failed to create account'))
    } finally {
      setCreating(false)
    }
  }

  async function addCoOwner() {
    if (!sharing) return
    try {
      await apiClient.post(`/api/accounts/${sharing.id}/co-owners`, { email })
      setEmail('')
      await loadCoOwners(sharing)
    } catch (err) {
      message.error(apiError(err, 'Failed to add co-owner'))
    }
  }

  async function removeCoOwner(account: OwnAccount, userId: string) {
    try {
      await apiClient.delete(`/api/accounts/${account.id}/co-owners/${userId}`)
      if (account.isOwner) await loadCoOwners(account)
      else { setSharing(null); await load() }
    } catch (err) {
      message.error(apiError(err, 'Failed to remove co-owner'))
    }
  }

  const columns: ColumnsType<OwnAccount> = [
    { title: 'Name', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: 'Type', dataIndex: 'type', width: 140 },
    { title: 'Access', width: 140, render: (_, a) => <Tag color={a.isOwner ? 'blue' : 'purple'}>{a.isOwner ? 'Owner' : 'Co-owner'}</Tag> },
    {
      title: '', width: 60,
      render: (_, a) => (a.isOwner
        ? <Button size="small" type="text" icon={<TeamOutlined />} title="Co-owners" onClick={() => setSharing(a)} />
        : (
          <Popconfirm title="Stop co-owning this account?" okText="Leave" onConfirm={() => void removeCoOwnerSelf(a)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} title="Leave" />
          </Popconfirm>
        )),
    },
  ]

  async function removeCoOwnerSelf(account: OwnAccount) {
    try {
      const me = await apiClient.get<{ id: string }>('/api/users/me')
      await removeCoOwner(account, me.data.id)
    } catch (err) {
      message.error(apiError(err, 'Failed to leave account'))
    }
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3} style={{ margin: 0 }}>Accounts</Title>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        Co-owners see and manage the transactions and bank tickets of an account. Partner accounts cannot be shared.
      </Paragraph>
      <div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true) }}>Add account</Button>
      </div>

      <Table rowKey="id" size="small" loading={loading} dataSource={accounts} columns={columns} pagination={{ pageSize: 30, hideOnSinglePage: true }} />

      <Modal
        open={createOpen} title="Add account" okText="Create" confirmLoading={creating}
        onOk={() => void createAccount()} onCancel={() => setCreateOpen(false)} destroyOnHidden forceRender
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 12 }} initialValues={{ type: 'BANK', initialBalance: 0 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Name must not be empty' }]}>
            <Input autoFocus maxLength={100} />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={ASSET_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))} />
          </Form.Item>
          <Form.Item name="initialBalance" label="Initial balance" style={{ marginBottom: 0 }}>
            <InputNumber style={{ width: '100%' }} precision={2} suffix="€" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={sharing !== null} title={sharing ? `Co-owners of "${sharing.name}"` : ''} footer={null} onCancel={() => setSharing(null)} destroyOnHidden>
        <Table<CoOwner>
          size="small" rowKey="userId" pagination={false} dataSource={coOwners} locale={{ emptyText: 'Not shared with anyone' }}
          columns={[
            { title: 'User', render: (_, c) => (c.name ? `${c.name} (${c.email})` : c.email) },
            {
              title: '', width: 40,
              render: (_, c) => (
                <Popconfirm title="Remove this co-owner?" okText="Remove" onConfirm={() => sharing && void removeCoOwner(sharing, c.userId)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
        <Space.Compact style={{ width: '100%', marginTop: 16 }}>
          <Input placeholder="Email of a registered user" value={email} onChange={(e) => setEmail(e.target.value)} onPressEnter={() => void addCoOwner()} />
          <Button type="primary" disabled={!email.trim()} onClick={() => void addCoOwner()}>Add</Button>
        </Space.Compact>
      </Modal>
    </Space>
  )
}
