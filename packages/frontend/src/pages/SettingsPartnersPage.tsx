import { useCallback, useEffect, useState } from 'react'
import { App as AntApp, Button, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined } from '@ant-design/icons'
import axios from 'axios'
import apiClient from '../api/apiClient'
import { TagsField, type TagOption } from '../components/TagPicker'

const { Title } = Typography

type PartnerAccount = { id: string; name: string; tags: { tag: TagOption }[] }

export default function SettingsPartnersPage() {
  const { message } = AntApp.useApp()
  const [partners, setPartners] = useState<PartnerAccount[]>([])
  const [allTags, setAllTags] = useState<TagOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PartnerAccount | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [form] = Form.useForm<{ name: string }>()

  const load = useCallback(async () => {
    try {
      const [accountsRes, tagsRes] = await Promise.all([
        apiClient.get<PartnerAccount[]>('/api/accounts', { params: { type: 'PAYMENT_PARTNER', withTags: 'true' } }),
        apiClient.get<TagOption[]>('/api/tags'),
      ])
      setPartners(accountsRes.data)
      setAllTags(tagsRes.data)
    } catch {
      message.error('Failed to load partner accounts')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!editing) return
    form.setFieldsValue({ name: editing.name })
    setTagIds(editing.tags.map((t) => t.tag.id))
  }, [editing, form])

  async function handleOk() {
    if (!editing) return
    const { name } = await form.validateFields()
    setSaving(true)
    try {
      if (name.trim() !== editing.name) await apiClient.patch(`/api/accounts/${editing.id}`, { name: name.trim() })
      await apiClient.put(`/api/tags/objects/account/${editing.id}`, { tagIds })
      message.success('Partner account updated')
      setEditing(null)
      await load()
    } catch (err) {
      const text = axios.isAxiosError(err) ? err.response?.data?.error : undefined
      message.error(text ?? 'Failed to save partner account')
    } finally {
      setSaving(false)
    }
  }

  const needle = search.trim().toLowerCase()
  const visiblePartners = needle
    ? partners.filter((p) => p.name.toLowerCase().includes(needle) || p.tags.some(({ tag }) => tag.name.toLowerCase().includes(needle)))
    : partners

  const columns: ColumnsType<PartnerAccount> = [
    { title: 'Name', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
    {
      title: 'Predefined tags',
      render: (_, p) => (
        <Space size={[4, 4]} wrap>
          {p.tags.map(({ tag }) => <Tag key={tag.id} style={{ marginInlineEnd: 0 }}>{tag.name}</Tag>)}
        </Space>
      ),
    },
    {
      title: '',
      width: 60,
      render: (_, p) => <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(p)} />,
    },
  ]

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3} style={{ margin: 0 }}>Partner accounts</Title>

      <Input.Search
        allowClear
        placeholder="Search by name or tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: 360 }}
      />

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={visiblePartners}
        columns={columns}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
      />

      <Modal
        open={editing !== null}
        title="Edit partner account"
        okText="Save"
        onOk={handleOk}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Name must not be empty' }]}>
            <Input autoFocus maxLength={100} />
          </Form.Item>
          <Form.Item label="Predefined tags" style={{ marginBottom: 0 }}>
            <TagsField tags={allTags} value={tagIds} onChange={setTagIds} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
