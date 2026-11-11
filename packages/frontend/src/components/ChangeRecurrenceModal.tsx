import { useEffect, useState } from 'react'
import { Alert, DatePicker, Descriptions, InputNumber, Modal, Radio, Space, Spin, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import apiClient from '../api/apiClient'
import { UNIT, disabledOutsideRange, formatPeriod, pickerFor, pickerFormat, plural, type RecurringInterval } from '../features/period'

const { Text } = Typography

type RecurrenceInfo = {
  templateName: string | null
  intervalType: RecurringInterval
  repeatEvery: number
  firstPeriodStart: string | null
  endPeriodStart: string | null
  currentPeriodStart: string
  lastScheduledPeriodStart: string | null
  futureCount: number
}

type Props = {
  /** Any plan of a recurring template (the template or one of its instances); null closes the dialog */
  planId: string | null
  onClose: () => void
  onChanged: () => void
}

export default function ChangeRecurrenceModal({ planId, onClose, onChanged }: Props) {
  const [messageApi, contextHolder] = message.useMessage()
  const [info, setInfo] = useState<RecurrenceInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState<number | null>(1)
  const [until, setUntil] = useState<Dayjs | null>(null)

  useEffect(() => {
    if (!planId) return
    let cancelled = false
    setInfo(null)
    setError(null)
    setMode('count')
    setUntil(null)
    setLoading(true)
    apiClient
      .get<RecurrenceInfo>(`/api/plans/${planId}/recurrence`)
      .then((res) => {
        if (cancelled) return
        setInfo(res.data)
        setCount(res.data.futureCount)
      })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load recurrence') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [planId])

  const unit = info ? UNIT[info.intervalType] : 'period'
  const canSave = mode === 'count' ? count !== null && count >= 0 : until !== null

  function disabledDate(d: Dayjs): boolean {
    return info ? disabledOutsideRange(info.intervalType, dayjs(info.currentPeriodStart))(d) : false
  }

  async function save() {
    if (!planId || !info) return
    setSaving(true)
    try {
      const body = mode === 'count'
        ? { mode, count }
        : { mode, until: until!.format('YYYY-MM-DD') }
      const res = await apiClient.post<{ created: number; deleted: number }>(`/api/plans/${planId}/recurrence`, body)
      messageApi.success(`Recurrence changed: ${res.data.created} plan(s) added, ${res.data.deleted} removed`)
      onChanged()
      onClose()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      messageApi.error(e.response?.data?.error ?? e.message ?? 'Failed to change recurrence')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={planId !== null}
      title="Change recurrence"
      okText="Apply"
      okButtonProps={{ disabled: !info || !canSave }}
      confirmLoading={saving}
      onOk={save}
      onCancel={onClose}
      destroyOnClose
    >
      {contextHolder}
      {loading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
      {error && <Alert type="error" message={error} showIcon />}
      {info && (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Template">{info.templateName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="First occurrence">{formatPeriod(info.intervalType, info.firstPeriodStart)}</Descriptions.Item>
            <Descriptions.Item label="Frequency">
              {info.repeatEvery === 1 ? `Every ${unit}` : `Every ${plural(info.repeatEvery, unit)}`}
            </Descriptions.Item>
            <Descriptions.Item label="Repeats until">{formatPeriod(info.intervalType, info.endPeriodStart ?? info.lastScheduledPeriodStart)}</Descriptions.Item>
            <Descriptions.Item label="Planned ahead">{plural(info.futureCount, 'future plan')}</Descriptions.Item>
          </Descriptions>

          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Space orientation="vertical">
              <Radio value="count">Repeat X times</Radio>
              <Radio value="until">Repeat until</Radio>
            </Space>
          </Radio.Group>

          {mode === 'count' ? (
            <Space>
              <InputNumber min={0} max={500} precision={0} value={count} onChange={(v) => setCount(v)} />
              <Text>{info.repeatEvery === 1 ? `${unit}s` : `× ${plural(info.repeatEvery, unit)}`} after the current {unit}</Text>
            </Space>
          ) : (
            <DatePicker
              picker={pickerFor(info.intervalType)}
              value={until}
              onChange={setUntil}
              disabledDate={disabledDate}
              format={pickerFormat(info.intervalType)}
              style={{ width: 220 }}
            />
          )}

          <Text type="secondary" style={{ fontSize: 12 }}>
            Only future plans change: scheduled plans after the new end are deleted, missing ones up to it are added as scheduled.
          </Text>
        </Space>
      )}
    </Modal>
  )
}
