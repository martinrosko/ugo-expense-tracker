import { useEffect, useState, type ReactNode } from 'react'
import { Button, DatePicker, Divider, Form, Input, InputNumber, Modal, Radio, Select, Space, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'

const { Text } = Typography

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

type Direction = 'income' | 'expense' | 'movement'

type AccountRef = { id: string; name: string; type: string }

/** The part of a transaction the dialog needs; template values are used as fallback for the due day. */
export type TxModalTx = {
  name: string | null
  plannedAmount: string | null
  fromAccountId: string | null
  toAccountId: string | null
  fromAccount?: { type: string } | null
  toAccount?: { type: string } | null
  dueDateConfig: string | null
  template?: { dueDateConfig: string | null } | null
  /** Execute mode: budget to preselect */
  budgetId?: string | null
  /** Execute mode: execution date to preselect (defaults to today) */
  executedOn?: string | null
}

export type TxModalBody = {
  name: string | null
  plannedAmount: string | null
  fromAccountId: string | null
  toAccountId: string | null
  dueDateConfig: string | null
  /** Execute mode only */
  executedOn?: string
  /** Execute mode with a budget list only */
  budgetId?: string | null
}

const WEEKDAY_BITMASK: Record<string, number> = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 }
const BITMASK_WEEKDAY: Record<number, string> = { 1: 'mon', 2: 'tue', 4: 'wed', 8: 'thu', 16: 'fri', 32: 'sat', 64: 'sun' }

const DAY_TYPE_OPTIONS = [
  { label: 'Day', value: 'day' },
  { label: 'Monday', value: 'mon' },
  { label: 'Tuesday', value: 'tue' },
  { label: 'Wednesday', value: 'wed' },
  { label: 'Thursday', value: 'thu' },
  { label: 'Friday', value: 'fri' },
  { label: 'Saturday', value: 'sat' },
  { label: 'Sunday', value: 'sun' },
]

const WEEKDAY_OPTIONS = [
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 4 },
  { label: 'Thursday', value: 8 },
  { label: 'Friday', value: 16 },
  { label: 'Saturday', value: 32 },
  { label: 'Sunday', value: 64 },
]

const MONTH_OPTIONS = [
  { label: 'January', value: 0 }, { label: 'February', value: 1 }, { label: 'March', value: 2 },
  { label: 'April', value: 3 }, { label: 'May', value: 4 }, { label: 'June', value: 5 },
  { label: 'July', value: 6 }, { label: 'August', value: 7 }, { label: 'September', value: 8 },
  { label: 'October', value: 9 }, { label: 'November', value: 10 }, { label: 'December', value: 11 },
]

/**
 * Add/edit a planned transaction ('plan') or log it as executed ('execute').
 * Execute mode asks for the execution date instead of the due day; with tx = null it logs an unplanned transaction.
 */
export default function TransactionModal({ open, tx, accounts, planIntervalType, mode = 'plan', budgets, budgetLocked, initialBudgetId, extra, resetKey, title, okText, okDisabled, onOk, onCancel }: {
  open: boolean
  tx: TxModalTx | null
  accounts: AccountRef[]
  planIntervalType: string
  mode?: 'plan' | 'execute'
  /** Shows a budget picker (execute mode); a null value means "no budget" */
  budgets?: { value: string | null; label: string }[]
  budgetLocked?: boolean
  /** Execute mode: budget to preselect for a new transaction (null = no budget) */
  initialBudgetId?: string | null
  /** Rendered above the form, e.g. plan and transaction pickers */
  extra?: ReactNode
  /** Changing it while open re-initializes the form from tx */
  resetKey?: string
  title?: string
  okText?: string
  okDisabled?: boolean
  onOk: (body: TxModalBody) => Promise<void>
  onCancel: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [direction, setDirection] = useState<Direction>('expense')
  const [dueN, setDueN] = useState(1)
  const [dueDayType, setDueDayType] = useState('day')
  const [dueDirection, setDueDirection] = useState<'from_start' | 'from_end'>('from_start')
  const [dueWeekday, setDueWeekday] = useState(1)  // bitmask for weekly
  const [dueMonth, setDueMonth] = useState(0)       // 0-11 offset for yearly

  const execute = mode === 'execute'
  const assetAccounts = accounts.filter((a) => ASSET_TYPES.has(a.type))
  const partnerAccounts = accounts.filter((a) => a.type === 'PAYMENT_PARTNER')

  function directionFromTx(t: TxModalTx): Direction {
    const f = ASSET_TYPES.has(t.fromAccount?.type ?? '')
    const v = ASSET_TYPES.has(t.toAccount?.type ?? '')
    if (f && v) return 'movement'
    if (v && !f) return 'income'
    return 'expense'
  }

  function parseDueDateConfig(cfg: string) {
    try {
      const obj = JSON.parse(cfg) as { weekDay?: number; day?: number; backwards?: boolean; week?: number; month?: number }
      if (planIntervalType === 'WEEKLY') {
        setDueWeekday(obj.weekDay ?? 1)
      } else {
        if (obj.month !== undefined) setDueMonth(obj.month)
        if (obj.weekDay !== undefined) {
          setDueDayType(BITMASK_WEEKDAY[obj.weekDay] ?? 'mon')
          setDueN(obj.week ?? 1)
          setDueDirection(obj.backwards ? 'from_end' : 'from_start')
        } else if (obj.day !== undefined) {
          setDueDayType('day')
          setDueN(obj.day)
          setDueDirection(obj.backwards ? 'from_end' : 'from_start')
        }
      }
    } catch { /* ignore */ }
  }

  function buildDueDateConfig(): string | null {
    if (planIntervalType === 'WEEKLY') return JSON.stringify({ weekDay: dueWeekday })
    const base: Record<string, unknown> = {}
    if (planIntervalType === 'YEARLY' && dueMonth > 0) base.month = dueMonth
    if (dueDayType === 'day') {
      base.day = dueN
      if (dueDirection === 'from_end') base.backwards = true
    } else {
      base.weekDay = WEEKDAY_BITMASK[dueDayType]
      if (dueN > 1) base.week = dueN
      if (dueDirection === 'from_end') base.backwards = true
    }
    return JSON.stringify(base)
  }

  useEffect(() => {
    if (!open) return
    form.resetFields()
    setDueN(1); setDueDayType('day'); setDueDirection('from_start'); setDueWeekday(1); setDueMonth(0)
    if (execute) form.setFieldsValue({ executedOn: tx?.executedOn ? dayjs(tx.executedOn) : dayjs(), budgetId: tx?.budgetId ?? initialBudgetId ?? null })
    if (tx) {
      setDirection(directionFromTx(tx))
      form.setFieldsValue({
        note: tx.name ?? undefined,
        plannedAmount: tx.plannedAmount != null ? parseFloat(tx.plannedAmount) : undefined,
        fromAccountId: tx.fromAccountId ?? undefined,
        toAccountId: tx.toAccountId ?? undefined,
      })
      const cfg = tx.dueDateConfig ?? tx.template?.dueDateConfig
      if (cfg) parseDueDateConfig(cfg)
    } else {
      setDirection('expense')
    }
  }, [open, resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDirectionChange(newDir: Direction) {
    const fromId = form.getFieldValue('fromAccountId') as string | undefined
    const toId = form.getFieldValue('toAccountId') as string | undefined
    // Swap accounts when toggling income ↔ expense
    if ((direction === 'expense' && newDir === 'income') || (direction === 'income' && newDir === 'expense')) {
      form.setFieldsValue({ fromAccountId: toId, toAccountId: fromId })
    } else {
      const newFrom = newDir === 'income' ? partnerAccounts : assetAccounts
      const newTo = newDir === 'movement' || newDir === 'income' ? assetAccounts : partnerAccounts
      if (fromId && !newFrom.find((a) => a.id === fromId)) form.setFieldValue('fromAccountId', undefined)
      if (toId && !newTo.find((a) => a.id === toId)) form.setFieldValue('toAccountId', undefined)
    }
    setDirection(newDir)
  }

  async function handleOk() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await onOk({
        name: values.note || null,
        plannedAmount: values.plannedAmount != null ? String(values.plannedAmount) : null,
        fromAccountId: values.fromAccountId ?? null,
        toAccountId: values.toAccountId ?? null,
        dueDateConfig: !execute && planIntervalType !== 'ONE_TIME' ? buildDueDateConfig() : null,
        ...(execute ? { executedOn: (values.executedOn as Dayjs).hour(12).toISOString() } : {}),
        ...(execute && budgets ? { budgetId: (values.budgetId as string | null) ?? null } : {}),
      })
    } finally { setSaving(false) }
  }

  const fromLabel = direction === 'income' ? 'Payment Partner' : direction === 'expense' ? 'Account' : 'From Account'
  const toLabel = direction === 'income' ? 'Account' : direction === 'expense' ? 'Payment Partner' : 'To Account'
  const fromOptions = direction === 'income' ? partnerAccounts : assetAccounts
  const toOptions = direction === 'movement' || direction === 'income' ? assetAccounts : partnerAccounts

  const hasDueDate = !execute && planIntervalType !== 'ONE_TIME'
  const isWeekly = planIntervalType === 'WEEKLY'
  const accountRules = execute ? [{ required: true, message: 'Select an account' }] : []

  return (
    <Modal
      open={open}
      title={title ?? (execute ? (tx ? 'Execute Transaction' : 'Log Transaction') : (tx ? 'Edit Transaction' : 'Add Transaction'))}
      okText={okText ?? (execute ? (tx ? 'Execute' : 'Log') : undefined)}
      okButtonProps={{ disabled: okDisabled }}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      destroyOnClose
      width={500}
    >
      <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={12}>
        {extra}
        {/* Direction selector */}
        <Radio.Group
          value={direction}
          onChange={(e) => handleDirectionChange(e.target.value as Direction)}
          optionType="button"
          buttonStyle="solid"
          style={{ width: '100%', display: 'flex' }}
        >
          <Radio.Button value="income" style={{ flex: 1, textAlign: 'center' }}>Income</Radio.Button>
          <Radio.Button value="expense" style={{ flex: 1, textAlign: 'center' }}>Expense</Radio.Button>
          <Radio.Button value="movement" style={{ flex: 1, textAlign: 'center' }}>Movement</Radio.Button>
        </Radio.Group>

        <Form form={form} layout="vertical" style={{ marginBottom: 0 }}>
          <Form.Item
            name="plannedAmount"
            label="Amount"
            rules={execute ? [{ required: true, type: 'number', min: 0.01, message: 'Enter a positive amount' }] : []}
          >
            <InputNumber style={{ width: '100%' }} precision={2} suffix="€" placeholder="0.00" />
          </Form.Item>
          {execute && (
            <Form.Item name="executedOn" label="Executed on" rules={[{ required: true }]}>
              <DatePicker allowClear={false} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="note" label="Note">
            <Input allowClear placeholder="Description…" />
          </Form.Item>
          <Form.Item name="fromAccountId" label={fromLabel} rules={accountRules}>
            <Select
              allowClear
              placeholder={`Select ${fromLabel.toLowerCase()}…`}
              options={fromOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
          <Form.Item name="toAccountId" label={toLabel} rules={accountRules} style={{ marginBottom: execute && budgets ? undefined : 0 }}>
            <Select
              allowClear
              placeholder={`Select ${toLabel.toLowerCase()}…`}
              options={toOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
          {execute && budgets && (
            <Form.Item name="budgetId" label="Budget" style={{ marginBottom: 0 }}>
              <Select options={budgets} disabled={budgetLocked} />
            </Form.Item>
          )}
        </Form>

        {/* Due date configurator */}
        {hasDueDate && (
          <>
            <Divider style={{ margin: '4px 0' }} />
            <div>
              <Text strong>Due day</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>Set the day when the transaction should be executed.</Text>
            </div>
            {isWeekly ? (
              <Select
                value={dueWeekday}
                onChange={setDueWeekday}
                style={{ width: '100%' }}
                options={WEEKDAY_OPTIONS}
              />
            ) : (
              <Space wrap size={4}>
                <Select
                  value={dueN}
                  onChange={setDueN}
                  style={{ width: 68 }}
                  options={Array.from(
                    { length: dueDayType === 'day' ? 31 : 5 },
                    (_, i) => ({ value: i + 1, label: `${i + 1}.` })
                  )}
                />
                <Select
                  value={dueDayType}
                  onChange={(v) => { setDueDayType(v); if (v !== 'day' && dueN > 5) setDueN(1) }}
                  style={{ width: 130 }}
                  options={DAY_TYPE_OPTIONS}
                />
                <Select
                  value={dueDirection}
                  onChange={setDueDirection}
                  style={{ width: 172 }}
                  options={[
                    { label: 'of the', value: 'from_start' },
                    { label: 'before the end of', value: 'from_end' },
                  ]}
                />
                {planIntervalType === 'YEARLY' ? (
                  <Select
                    value={dueMonth}
                    onChange={setDueMonth}
                    style={{ width: 130 }}
                    options={MONTH_OPTIONS}
                  />
                ) : (
                  <Text>month.</Text>
                )}
              </Space>
            )}
          </>
        )}

        {/* Tags placeholder */}
        <Divider style={{ margin: '4px 0' }} />
        <div>
          <Text strong>Tags</Text>
          <br />
          <Button size="small" icon={<PlusOutlined />} disabled style={{ marginTop: 8 }}>Add Tag</Button>
        </div>
      </Space>
    </Modal>
  )
}
