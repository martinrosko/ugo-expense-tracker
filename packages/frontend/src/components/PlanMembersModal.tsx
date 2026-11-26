import { useCallback, useEffect, useState } from 'react'
import { App, Button, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'
import { apiError } from '../features/planTransactions'

type Member = { userId: string; email: string; name: string; role: 'VIEWER' | 'CONTRIBUTOR' }

const ROLE_OPTIONS = [
  { value: 'VIEWER', label: 'Viewer (read-only)' },
  { value: 'CONTRIBUTOR', label: 'Contributor (own transactions)' },
]

export default function PlanMembersModal({ planId, title, onClose }: { planId: string | null; title: string; onClose: () => void }) {
  const { message } = App.useApp()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('VIEWER')

  const load = useCallback(async () => {
    if (!planId) return
    setLoading(true)
    try {
      setMembers((await apiClient.get<Member[]>(`/api/plans/${planId}/members`)).data)
    } catch (err) {
      message.error(apiError(err, 'Failed to load members'))
    } finally {
      setLoading(false)
    }
  }, [planId, message])

  useEffect(() => {
    if (planId) { setEmail(''); void load() }
  }, [planId, load])

  async function save(next: { email: string; role: Member['role'] }, done?: () => void) {
    try {
      await apiClient.post(`/api/plans/${planId}/members`, next)
      done?.()
      await load()
    } catch (err) {
      message.error(apiError(err, 'Failed to save member'))
    }
  }

  async function remove(userId: string) {
    try {
      await apiClient.delete(`/api/plans/${planId}/members/${userId}`)
      await load()
    } catch (err) {
      message.error(apiError(err, 'Failed to remove member'))
    }
  }

  return (
    <Modal open={planId !== null} title={`Share "${title}"`} footer={null} onCancel={onClose} destroyOnClose>
      <Typography.Paragraph type="secondary">
        Members see this plan, its budgets and totals. Transactions on accounts they do not co-own show only date and amount.
        Sharing a template also shares the plans generated from it.
      </Typography.Paragraph>
      <Table<Member>
        size="small" rowKey="userId" loading={loading} pagination={false} dataSource={members}
        locale={{ emptyText: 'Not shared with anyone' }}
        columns={[
          { title: 'User', key: 'user', render: (_: unknown, m) => (m.name ? `${m.name} (${m.email})` : m.email) },
          {
            title: 'Role', key: 'role', width: 220,
            render: (_: unknown, m) => (
              <Select size="small" style={{ width: 200 }} value={m.role} options={ROLE_OPTIONS} onChange={(value) => void save({ email: m.email, role: value })} />
            ),
          },
          {
            title: '', key: 'remove', width: 40,
            render: (_: unknown, m) => (
              <Popconfirm title="Remove this member?" okText="Remove" onConfirm={() => void remove(m.userId)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
      <Space.Compact style={{ width: '100%', marginTop: 16 }}>
        <Input placeholder="Email of a registered user" value={email} onChange={(e) => setEmail(e.target.value)} onPressEnter={() => void save({ email, role }, () => setEmail(''))} />
        <Select style={{ width: 220 }} value={role} options={ROLE_OPTIONS} onChange={setRole} />
        <Button type="primary" disabled={!email.trim()} onClick={() => void save({ email, role }, () => setEmail(''))}>Add</Button>
      </Space.Compact>
    </Modal>
  )
}
