import { useEffect, useState } from 'react'
import { Button, Empty, Input, Modal, Space, Tag } from 'antd'
import { TagsOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'

export type TagOption = { id: string; name: string }

/**
 * Loads all tags while `open` and, for an existing plan/budget, its current tags (or uses `initial` when given).
 * `dirty` tells whether the user changed the selection, so callers can avoid overwriting tags they never loaded.
 */
export function useTagSelection(open: boolean, object?: { type: 'plan' | 'budget' | 'account'; id: string }, initial?: string[]) {
  const [allTags, setAllTags] = useState<TagOption[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const objectId = object?.id
  const objectType = object?.type

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDirty(false)
    setTagIds(initial ?? [])
    apiClient.get<TagOption[]>('/api/tags')
      .then((res) => { if (!cancelled) setAllTags(res.data) })
      .catch(() => undefined)
    if (!initial && objectType && objectId) {
      apiClient.get<TagOption[]>(`/api/tags/objects/${objectType}/${objectId}`)
        .then((res) => { if (!cancelled) setTagIds(res.data.map((t) => t.id)) })
        .catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [open, objectType, objectId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    allTags,
    tagIds,
    dirty,
    setTagIds: (ids: string[]) => { setTagIds(ids); setDirty(true) },
  }
}

/** Dialog listing all tags as toggleable chips; confirming returns the selected ids. */
export function TagPickerModal({ open, tags, value, onOk, onCancel }: {
  open: boolean
  tags: TagOption[]
  value: string[]
  onOk: (ids: string[]) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<string[]>(value)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!open) return
    setSelected(value)
    setFilter('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const needle = filter.trim().toLowerCase()
  const visible = tags.filter((t) => t.name.toLowerCase().includes(needle))
  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  return (
    <Modal open={open} title="Select tags" okText="Apply" onOk={() => onOk(selected)} onCancel={onCancel} destroyOnHidden width={480}>
      {tags.length === 0 ? (
        <Empty description="No tags yet. Create them in Settings › Tags." />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
          <Input allowClear placeholder="Filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Space size={[8, 8]} wrap>
            {visible.map((t) => (
              <Tag.CheckableTag
                key={t.id}
                checked={selected.includes(t.id)}
                onChange={(checked) => toggle(t.id, checked)}
                style={{ fontSize: 14, padding: '4px 10px', border: '1px solid #d9d9d9' }}
              >
                {t.name}
              </Tag.CheckableTag>
            ))}
          </Space>
        </Space>
      )}
    </Modal>
  )
}

/** Selected tags as chips (optionally removable with a small x) plus a button that opens the picker dialog. */
export function TagsField({ tags, value, onChange, removable }: {
  tags: TagOption[]
  value: string[]
  onChange: (ids: string[]) => void
  removable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = tags.filter((t) => value.includes(t.id))
  return (
    <>
      <Space size={[4, 4]} wrap>
        {selected.map((t) => (
          <Tag
            key={t.id}
            style={{ marginInlineEnd: 0 }}
            closable={removable}
            onClose={(e) => { e.preventDefault(); onChange(value.filter((id) => id !== t.id)) }}
          >
            {t.name}
          </Tag>
        ))}
        <Button size="small" icon={<TagsOutlined />} onClick={() => setOpen(true)}>
          Add
        </Button>
      </Space>
      <TagPickerModal
        open={open}
        tags={tags}
        value={value}
        onOk={(ids) => { onChange(ids); setOpen(false) }}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
