import { useEffect, useState } from 'react'
import { DatePicker, InputNumber, Modal, Radio, Space, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import apiClient from '../api/apiClient'
import { UNIT, disabledOutsideRange, pickerFor, pickerFormat, type RecurringInterval } from '../features/period'

const { Text } = Typography
const { RangePicker } = DatePicker

type Props = {
  /** The Draft plan to activate; null closes the dialog */
  plan: { id: string; name: string | null; intervalType: string } | null
  onClose: () => void
  onActivated: () => void
}

export default function ActivatePlanModal({ plan, onClose, onActivated }: Props) {
  const [messageApi, contextHolder] = message.useMessage()
  const [saving, setSaving] = useState(false)
  const [repeatEvery, setRepeatEvery] = useState<number | null>(1)
  const [start, setStart] = useState<Dayjs | null>(null)
  const [mode, setMode] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState<number | null>(1)
  const [until, setUntil] = useState<Dayjs | null>(null)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const oneTime = plan?.intervalType === 'ONE_TIME'
  const interval = (oneTime ? null : plan?.intervalType) as RecurringInterval | null
  const unit = interval ? UNIT[interval] : 'period'

  useEffect(() => {
    if (!plan) return
    setRepeatEvery(1)
    setStart(dayjs())
    setMode('count')
    setCount(1)
    setUntil(null)
    setRange([dayjs(), dayjs()])
  }, [plan])

  const canSave = oneTime
    ? !!range?.[0] && !!range?.[1]
    : !!repeatEvery && !!start && (mode === 'count' ? count !== null && count >= 0 : !!until)

  async function save() {
    if (!plan) return
    const body = oneTime
      ? { startDate: range![0]!.format('YYYY-MM-DD'), endDate: range![1]!.format('YYYY-MM-DD') }
      : {
          repeatEvery,
          startPeriod: start!.format('YYYY-MM-DD'),
          ...(mode === 'count' ? { mode, count } : { mode, until: until!.format('YYYY-MM-DD') }),
        }
    setSaving(true)
    try {
      await apiClient.post(`/api/plans/${plan.id}/activate`, body)
      messageApi.success('Plan activated')
      onActivated()
      onClose()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      messageApi.error(e.response?.data?.error ?? e.message ?? 'Failed to activate plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={plan !== null}
      title={`Activate ${plan?.name ?? 'plan'}`}
      okText="Activate"
      okButtonProps={{ disabled: !canSave }}
      confirmLoading={saving}
      onOk={save}
      onCancel={onClose}
      destroyOnClose
    >
      {contextHolder}
      {oneTime ? (
        <Space orientation="vertical" size="small">
          <Text>Plan runs from</Text>
          <RangePicker
            value={range}
            onChange={(v) => setRange(v)}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
          />
        </Space>
      ) : interval && (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Text>Repeat every</Text>
            <InputNumber min={1} max={1000} precision={0} value={repeatEvery} onChange={(v) => setRepeatEvery(v)} />
            <Text>{unit}(s)</Text>
          </Space>

          <Space orientation="vertical" size={4}>
            <Text>Start period</Text>
            <DatePicker
              picker={pickerFor(interval)}
              value={start}
              onChange={setStart}
              allowClear={false}
              disabledDate={disabledOutsideRange(interval, dayjs())}
              format={pickerFormat(interval)}
              style={{ width: 220 }}
            />
          </Space>

          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Space orientation="vertical">
              <Radio value="count">Repeat X times</Radio>
              <Radio value="until">Repeat until</Radio>
            </Space>
          </Radio.Group>

          {mode === 'count' ? (
            <Space>
              <InputNumber min={0} max={500} precision={0} value={count} onChange={(v) => setCount(v)} />
              <Text>{unit}s after the start period</Text>
            </Space>
          ) : (
            <DatePicker
              picker={pickerFor(interval)}
              value={until}
              onChange={setUntil}
              disabledDate={disabledOutsideRange(interval, start ?? dayjs())}
              format={pickerFormat(interval)}
              style={{ width: 220 }}
            />
          )}

          <Text type="secondary" style={{ fontSize: 12 }}>
            The plan for the current period becomes Active, later ones are created as Scheduled.
          </Text>
        </Space>
      )}
    </Modal>
  )
}
