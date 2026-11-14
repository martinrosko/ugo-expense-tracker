import { useCallback, useEffect, useState } from 'react'
import { App as AntApp, Button, Empty, Form, Input, Modal, Space, Spin, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import axios from 'axios'
import apiClient from '../api/apiClient'

const { Title } = Typography

type TagItem = { id: string; name: string }

// null = dialog closed, 'new' = add dialog, otherwise the tag being renamed
type Editing = TagItem | 'new' | null

export default function SettingsTagsPage() {
  const { message, modal } = AntApp.useApp()
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{ name: string }>()

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<TagItem[]>('/api/tags')
      setTags(res.data)
    } catch {
      message.error('Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (editing === null) return
    form.setFieldsValue({ name: editing === 'new' ? '' : editing.name })
  }, [editing, form])

  const isDuplicate = (name: string) => {
    const wanted = name.trim().toLowerCase()
    const selfId = editing && editing !== 'new' ? editing.id : null
    return tags.some((t) => t.id !== selfId && t.name.trim().toLowerCase() === wanted)
  }

  async function handleOk() {
    const { name } = await form.validateFields()
    setSaving(true)
    try {
      if (editing === 'new') {
        await apiClient.post('/api/tags', { name: name.trim() })
        message.success('Tag created')
      } else if (editing) {
        await apiClient.patch(`/api/tags/${editing.id}`, { name: name.trim() })
        message.success('Tag renamed')
      }
      setEditing(null)
      await load()
    } catch (err) {
      const text = axios.isAxiosError(err) ? err.response?.data?.error : undefined
      message.error(text ?? 'Failed to save tag')
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(tag: TagItem) {
    modal.confirm({
      title: `Delete tag "${tag.name}"?`,
      content: 'The tag will also be removed from all transactions it is assigned to.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await apiClient.delete(`/api/tags/${tag.id}`)
          message.success('Tag deleted')
          await load()
        } catch {
          message.error('Failed to delete tag')
          throw new Error('delete failed')
        }
      },
    })
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3} style={{ margin: 0 }}>Tags</Title>

      <Spin spinning={loading}>
        {!loading && tags.length === 0 ? (
          <Empty description="No tags yet" />
        ) : (
          <Space size={[8, 8]} wrap>
            {tags.map((tag) => (
              <Tag
                key={tag.id}
                closable
                onClose={(e) => { e.preventDefault(); confirmDelete(tag) }}
                onClick={() => setEditing(tag)}
                style={{ cursor: 'pointer', fontSize: 14, padding: '4px 10px' }}
              >
                {tag.name}
              </Tag>
            ))}
          </Space>
        )}
      </Spin>

      <div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Add tag</Button>
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New tag' : 'Edit tag'}
        okText={editing === 'new' ? 'Add' : 'Save'}
        onOk={handleOk}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={handleOk} style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, whitespace: true, message: 'Name must not be empty' },
              { validator: (_, value: string) => (value && isDuplicate(value) ? Promise.reject(new Error('A tag with this name already exists')) : Promise.resolve()) },
            ]}
          >
            <Input autoFocus maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
