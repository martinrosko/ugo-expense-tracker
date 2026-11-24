import { useEffect, useState, type ReactNode } from 'react'
import { App as AntApp, Input, Modal, Space, Typography } from 'antd'
import apiClient from '../api/apiClient'
import { TagsField, useTagSelection } from './TagPicker'

const { Text } = Typography

type PartnerRef = { id: string; name: string; type: string }

/** Creates a payment partner account, or edits the name and predefined tags of an existing one. */
export default function PartnerTagsModal({ partner, creating, existingNames = [], onClose, onSaved, onCreated }: {
  /** The partner to edit */
  partner?: { id: string; name: string } | null
  /** Opens the dialog for a new partner instead */
  creating?: boolean
  /** Names already in use, to reject duplicates */
  existingNames?: string[]
  onClose: () => void
  /** Called after an edit was saved; tagIds is null when the tags were left untouched */
  onSaved?: (partnerId: string, tagIds: string[] | null, name: string) => void
  onCreated?: (partner: PartnerRef) => void
}) {
  const { message } = AntApp.useApp()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const open = !!partner || !!creating
  const tagSel = useTagSelection(open, partner ? { type: 'account', id: partner.id } : undefined)

  useEffect(() => {
    if (open) setName(partner?.name ?? '')
  }, [open, partner?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim()
  const taken = new Set(existingNames.filter((n) => n !== partner?.name).map((n) => n.trim().toLowerCase()))
  const duplicate = taken.has(trimmed.toLowerCase())

  async function handleOk() {
    if (!trimmed || duplicate) return
    setSaving(true)
    try {
      if (partner) {
        if (trimmed !== partner.name) await apiClient.patch(`/api/accounts/${partner.id}`, { name: trimmed })
        if (tagSel.dirty) await apiClient.put(`/api/tags/objects/account/${partner.id}`, { tagIds: tagSel.tagIds })
        message.success('Partner account updated')
        onSaved?.(partner.id, tagSel.dirty ? tagSel.tagIds : null, trimmed)
      } else {
        const res = await apiClient.post<{ id: string; name: string }>('/api/accounts', { name: trimmed, type: 'PAYMENT_PARTNER' })
        if (tagSel.tagIds.length > 0) await apiClient.put(`/api/tags/objects/account/${res.data.id}`, { tagIds: tagSel.tagIds })
        onCreated?.({ id: res.data.id, name: res.data.name, type: 'PAYMENT_PARTNER' })
      }
      onClose()
    } catch {
      message.error('Failed to save partner account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={partner ? 'Edit partner account' : 'New partner account'}
      okText={partner ? 'Save' : 'Create'}
      okButtonProps={{ disabled: !trimmed || duplicate }}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnHidden
      width={420}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
        <div>
          <Text strong>Name</Text>
          <Input
            autoFocus
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleOk}
            status={duplicate ? 'error' : undefined}
            style={{ marginTop: 4 }}
          />
          {duplicate && <Text type="danger" style={{ fontSize: 12 }}>A partner account with this name already exists</Text>}
        </div>
        <div>
          <Text strong>Predefined tags</Text>
          <div style={{ marginTop: 4 }}>
            <TagsField tags={tagSel.allTags} value={tagSel.tagIds} onChange={tagSel.setTagIds} />
          </div>
        </div>
      </Space>
    </Modal>
  )
}

/** Select `labelRender` that makes the selected value clickable to edit it. */
export function editableLabelRender(title: string, onEdit: (value: string) => void) {
  return (option: { value?: string | number | null; label?: ReactNode }) => (
    <span
      title={title}
      // Sits above the search input that overlays the selected value
      style={{ cursor: 'pointer', textDecoration: 'underline dotted', position: 'relative', zIndex: 2 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onEdit(String(option.value))
      }}
    >
      {option.label}
    </span>
  )
}

export const partnerLabelRender = (onEdit: (id: string) => void) => editableLabelRender('Click to edit partner account', onEdit)
