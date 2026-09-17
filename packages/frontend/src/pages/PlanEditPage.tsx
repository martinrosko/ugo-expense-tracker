import { useEffect, useState, useCallback } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import {
  Typography, Space, Button, Collapse, Table, Tag, Spin, Alert,
  Modal, Form, Input, InputNumber, Select, Popconfirm, message,
  Divider, Tooltip, Radio, DatePicker,
} from 'antd'
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import apiClient from '../api/apiClient'

const { Title, Text } = Typography

// ─── Types ───────────────────────────────────────────────────────────────────

type AccountRef = { id: string; name: string; type: string }
type Account = { id: string; name: string; type: 'CASH' | 'BANK' | 'INVESTMENT' | 'PAYMENT_PARTNER' }

type TxTemplate = {
  name: string | null
  plannedAmount: string | null
  fromAccountId: string | null
  toAccountId: string | null
  dueDateConfig: string | null
}

type Transaction = {
  id: string
  name: string | null
  amount: string | null
  plannedAmount: string | null
  fromAccountId: string | null
  toAccountId: string | null
  dueDateConfig: string | null
  executedOn: string | null
  fromAccount: AccountRef | null
  toAccount: AccountRef | null
  planId: string | null
  budgetId: string | null
  type: string
  templateId: string | null
  template: TxTemplate | null
}

type BudgetTemplate = { name: string | null; amount: string | null }

type Budget = {
  id: string
  name: string | null
  amount: string | null
  planId: string
  templateId: string | null
  template: BudgetTemplate | null
  transactions: Transaction[]
}

type Plan = {
  id: string
  name: string | null
  intervalType: string
  isTemplate: boolean
  stateCode: number
  statusCode: number
  templateId: string | null
  template: { name: string | null } | null
  budgets: Budget[]
  transactions: Transaction[]
}

type PlansOverviewState = {
  mode?: 'active' | 'week' | 'month' | 'year' | 'templates'
  offset?: number
  splitView?: boolean
  expandedTemplateIds?: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

type TxKind = 'income' | 'expense' | 'transfer' | 'unknown'

function txKind(fromType?: string | null, toType?: string | null): TxKind {
  const fromAsset = ASSET_TYPES.has(fromType ?? '')
  const toAsset = ASSET_TYPES.has(toType ?? '')
  if (fromAsset && toAsset) return 'transfer'
  if (toAsset && !fromAsset) return 'income'
  if (fromAsset && !toAsset) return 'expense'
  return 'unknown'
}

const KIND_COLOR: Record<TxKind, string> = { income: 'green', expense: 'red', transfer: 'blue', unknown: 'default' }
const KIND_LABEL: Record<TxKind, string> = { income: 'Income', expense: 'Expense', transfer: 'Transfer', unknown: '—' }

const STATUS_LABEL: Record<number, string> = { 0: 'Draft', 1: 'Active', 2: 'Scheduled', 3: 'Completed', 4: 'Cancelled' }
const STATUS_COLOR: Record<number, string> = { 0: 'default', 1: 'green', 2: 'blue', 3: 'cyan', 4: 'red' }

function fmtAmount(v: string | null | undefined): string {
  if (!v) return '—'
  const n = parseFloat(v)
  return isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function amountValue(v: string | null | undefined): number {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? 0 : n
}

// ─── Transaction modal ────────────────────────────────────────────────────────

type Direction = 'income' | 'expense' | 'movement'

type TxSaveBody = {
  name: string | null
  plannedAmount: string | null
  fromAccountId: string | null
  toAccountId: string | null
  dueDateConfig: string | null
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

function TransactionModal({ open, tx, accounts, planIntervalType, onOk, onCancel }: {
  open: boolean
  tx: Transaction | null
  accounts: Account[]
  planIntervalType: string
  onOk: (body: TxSaveBody) => Promise<void>
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

  const assetAccounts = accounts.filter((a) => ASSET_TYPES.has(a.type))
  const partnerAccounts = accounts.filter((a) => a.type === 'PAYMENT_PARTNER')

  function directionFromTx(t: Transaction): Direction {
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
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

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
        dueDateConfig: planIntervalType !== 'ONE_TIME' ? buildDueDateConfig() : null,
      })
    } finally { setSaving(false) }
  }

  const fromLabel = direction === 'income' ? 'Payment Partner' : direction === 'expense' ? 'Account' : 'From Account'
  const toLabel = direction === 'income' ? 'Account' : direction === 'expense' ? 'Payment Partner' : 'To Account'
  const fromOptions = direction === 'income' ? partnerAccounts : assetAccounts
  const toOptions = direction === 'movement' || direction === 'income' ? assetAccounts : partnerAccounts

  const hasDueDate = planIntervalType !== 'ONE_TIME'
  const isWeekly = planIntervalType === 'WEEKLY'

  return (
    <Modal
      open={open}
      title={tx ? 'Edit Transaction' : 'Add Transaction'}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      destroyOnClose
      width={500}
    >
      <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={12}>
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
          <Form.Item name="plannedAmount" label="Amount">
            <InputNumber style={{ width: '100%' }} precision={2} suffix="€" placeholder="0.00" />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input allowClear placeholder="Description…" />
          </Form.Item>
          <Form.Item name="fromAccountId" label={fromLabel}>
            <Select
              allowClear
              placeholder={`Select ${fromLabel.toLowerCase()}…`}
              options={fromOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
          <Form.Item name="toAccountId" label={toLabel} style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder={`Select ${toLabel.toLowerCase()}…`}
              options={toOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
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

// ─── Budget modal ─────────────────────────────────────────────────────────────

type BudgetSaveBody = { name: string | null; amount: string | null }

function BudgetModal({ open, budget, onOk, onCancel }: {
  open: boolean
  budget: Budget | null         // null = add new
  onOk: (body: BudgetSaveBody) => Promise<void>
  onCancel: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isInstance = !!(budget?.templateId)
  const tpl = budget?.template ?? null

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (budget) {
      form.setFieldsValue({
        name: budget.name ?? undefined,
        amount: budget.amount != null ? parseFloat(budget.amount) : undefined,
      })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleOk() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await onOk({
        name: values.name || null,
        amount: values.amount != null ? String(values.amount) : null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={budget ? 'Edit Budget' : 'Add Budget'}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {isInstance && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, fontSize: 12 }}
            message="Inherited values shown as placeholders. Clear a field to fall back to the template value."
          />
        )}
        <Form.Item
          name="name"
          label="Name"
          rules={budget ? [] : [{ required: true, message: 'Name is required' }]}
        >
          <Input
            allowClear
            placeholder={isInstance && tpl?.name ? `Inherited: ${tpl.name}` : 'e.g. Groceries'}
            suffix={isInstance && tpl?.name
              ? <Tooltip title={`Template: ${tpl.name}`}><InfoCircleOutlined style={{ color: '#ccc' }} /></Tooltip>
              : null}
          />
        </Form.Item>
        <Form.Item name="amount" label="Budget Amount (envelope)">
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            precision={2}
            suffix="€"
            placeholder={isInstance && tpl?.amount ? `Inherited: ${fmtAmount(tpl.amount)}` : '0.00'}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// ─── Transaction table ────────────────────────────────────────────────────────

function TransactionTable({ transactions, accounts, isLocked, onEdit, onDelete }: {
  transactions: Transaction[]
  accounts: Account[]
  isLocked: boolean
  onEdit: (tx: Transaction) => void
  onDelete: (tx: Transaction) => void
}) {
  const accMap = new Map(accounts.map((a) => [a.id, a]))

  // Resolve the effective account for a side, falling back to template
  function resolveAccount(tx: Transaction, side: 'from' | 'to') {
    const storedId = side === 'from' ? tx.fromAccountId : tx.toAccountId
    const storedAcc = side === 'from' ? tx.fromAccount : tx.toAccount
    if (storedId) return { acc: storedAcc ?? accMap.get(storedId) ?? null, inherited: false }
    const tplId = side === 'from' ? tx.template?.fromAccountId : tx.template?.toAccountId
    return { acc: tplId ? accMap.get(tplId) ?? null : null, inherited: true }
  }

  return (
    <Table<Transaction>
      dataSource={transactions}
      rowKey="id"
      size="small"
      pagination={false}
      locale={{ emptyText: 'No transactions' }}
      columns={[
        {
          title: 'Name',
          key: 'name',
          render: (_: unknown, tx: Transaction) => {
            const effective = tx.name ?? tx.template?.name
            const inherited = !tx.name && !!tx.template?.name
            return (
              <Space size={4}>
                <span style={inherited ? { color: '#999', fontStyle: 'italic' } : undefined}>
                  {effective ?? <Text type="secondary">—</Text>}
                </span>
                {inherited && (
                  <Tooltip title="Inherited from template">
                    <InfoCircleOutlined style={{ fontSize: 11, color: '#ccc' }} />
                  </Tooltip>
                )}
              </Space>
            )
          },
        },
        {
          title: 'Planned',
          key: 'planned',
          align: 'right',
          width: 130,
          render: (_: unknown, tx: Transaction) => {
            const v = tx.plannedAmount ?? tx.template?.plannedAmount
            const inherited = !tx.plannedAmount && !!tx.template?.plannedAmount
            return (
              <span style={inherited ? { color: '#999', fontStyle: 'italic' } : undefined}>
                {fmtAmount(v)}
              </span>
            )
          },
        },
        {
          title: 'From',
          key: 'from',
          render: (_: unknown, tx: Transaction) => {
            const { acc, inherited } = resolveAccount(tx, 'from')
            return acc
              ? <span style={inherited ? { color: '#999' } : undefined}>
                  {acc.name} <Text type="secondary" style={{ fontSize: 11 }}>({acc.type})</Text>
                </span>
              : <Text type="secondary">—</Text>
          },
        },
        {
          title: 'To',
          key: 'to',
          render: (_: unknown, tx: Transaction) => {
            const { acc, inherited } = resolveAccount(tx, 'to')
            return acc
              ? <span style={inherited ? { color: '#999' } : undefined}>
                  {acc.name} <Text type="secondary" style={{ fontSize: 11 }}>({acc.type})</Text>
                </span>
              : <Text type="secondary">—</Text>
          },
        },
        {
          title: 'Direction',
          key: 'direction',
          width: 90,
          render: (_: unknown, tx: Transaction) => {
            const { acc: fromAcc } = resolveAccount(tx, 'from')
            const { acc: toAcc } = resolveAccount(tx, 'to')
            const kind = txKind(fromAcc?.type, toAcc?.type)
            return kind === 'unknown'
              ? <Text type="secondary">—</Text>
              : <Tag color={KIND_COLOR[kind]}>{KIND_LABEL[kind]}</Tag>
          },
        },
        {
          title: '',
          key: 'actions',
          width: 72,
          render: (_: unknown, tx: Transaction) => (
            <Space size={2}>
              <Button size="small" type="text" icon={<EditOutlined />} disabled={isLocked} onClick={() => onEdit(tx)} />
              <Popconfirm title="Delete this transaction?" onConfirm={() => onDelete(tx)} okText="Delete" okType="danger" disabled={isLocked}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={isLocked} />
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TxModalState = { open: boolean; tx: Transaction | null; planId: string | null; budgetId: string | null }
type BudgetModalState = { open: boolean; budget: Budget | null }

let temporaryId = 0

function nextTemporaryId(kind: 'budget' | 'transaction') {
  temporaryId += 1
  return `new-${kind}-${temporaryId}`
}

function clonePlan(plan: Plan): Plan {
  return structuredClone(plan)
}

function isTemporaryId(id: string) {
  return id.startsWith('new-')
}

function sameSaveBody<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export default function PlanEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const returnState = (location.state as { returnState?: PlansOverviewState } | null)?.returnState
  const [messageApi, contextHolder] = message.useMessage()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [originalPlan, setOriginalPlan] = useState<Plan | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingChanges, setSavingChanges] = useState(false)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  const [txModal, setTxModal] = useState<TxModalState>({ open: false, tx: null, planId: null, budgetId: null })
  const [budgetModal, setBudgetModal] = useState<BudgetModalState>({ open: false, budget: null })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [planRes, accountsRes] = await Promise.all([
        // Cast to unknown so we can detect old vs new API response shape
        apiClient.get<Plan & { transactions?: Transaction[] }>(`/api/plans/${id}`),
        apiClient.get<Account[]>('/api/accounts'),
      ])
      setAccounts(accountsRes.data)
      const raw = planRes.data

      if (Array.isArray(raw.transactions)) {
        // New endpoint: transactions and template data are already embedded
        const loadedPlan = raw as Plan
        setPlan(loadedPlan)
        setOriginalPlan(clonePlan(loadedPlan))
        return
      }

      // Old endpoint: fetch budgets and transactions separately then assemble
      const [budgetsRes, txRes] = await Promise.all([
        // GET /api/budgets applies template inheritance → names/amounts are effective values
        apiClient.get<Budget[]>('/api/budgets', { params: { planId: id } }),
        apiClient.get<Transaction[]>('/api/transactions', { params: { planId: id } }),
      ])

      const budgetTxs = new Map(budgetsRes.data.map((b) => [b.id, [] as Transaction[]]))
      const directTxs: Transaction[] = []
      for (const tx of txRes.data) {
        if (tx.budgetId) budgetTxs.get(tx.budgetId)?.push(tx)
        else directTxs.push(tx)
      }

      // Resolve plan's effective name if it's an instance with null name
      let planTemplate = raw.template ?? null
      if (!raw.name && raw.templateId && !planTemplate) {
        try {
          const tplRes = await apiClient.get<{ name: string | null }>(`/api/plans/${raw.templateId}`)
          planTemplate = { name: tplRes.data.name }
        } catch { /* non-critical */ }
      }

      const loadedPlan = {
        ...raw,
        template: planTemplate,
        budgets: budgetsRes.data.map((b) => ({ ...b, transactions: budgetTxs.get(b.id) ?? [] })),
        transactions: directTxs,
      } as Plan
      setPlan(loadedPlan)
      setOriginalPlan(clonePlan(loadedPlan))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string }
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // ── Transaction CRUD ──────────────────────────────────────────────────────────

  async function saveTx(body: TxSaveBody) {
    if (!plan) return
    const fromAccount = body.fromAccountId ? accounts.find((account) => account.id === body.fromAccountId) ?? null : null
    const toAccount = body.toAccountId ? accounts.find((account) => account.id === body.toAccountId) ?? null : null
    const updatedTx: Transaction = txModal.tx
      ? { ...txModal.tx, ...body, fromAccount, toAccount }
      : {
          id: nextTemporaryId('transaction'), ...body,
          fromAccount, toAccount,
          planId: txModal.budgetId ? null : txModal.planId,
          budgetId: txModal.budgetId,
          type: 'TRANSACTION', templateId: null, template: null,
          amount: null, executedOn: null,
        }
    setPlan({
      ...plan,
      transactions: txModal.budgetId
        ? plan.transactions
        : txModal.tx
          ? plan.transactions.map((tx) => tx.id === updatedTx.id ? updatedTx : tx)
          : [...plan.transactions, updatedTx],
      budgets: plan.budgets.map((budget) => budget.id !== txModal.budgetId
        ? budget
        : {
            ...budget,
            transactions: txModal.tx
              ? budget.transactions.map((tx) => tx.id === updatedTx.id ? updatedTx : tx)
              : [...budget.transactions, updatedTx],
          }),
    })
    setTxModal({ open: false, tx: null, planId: null, budgetId: null })
  }

  async function deleteTx(tx: Transaction) {
    if (!plan) return
    setPlan({
      ...plan,
      transactions: plan.transactions.filter((candidate) => candidate.id !== tx.id),
      budgets: plan.budgets.map((budget) => ({
        ...budget,
        transactions: budget.transactions.filter((candidate) => candidate.id !== tx.id),
      })),
    })
  }

  // ── Budget CRUD ───────────────────────────────────────────────────────────────

  async function saveBudget(body: BudgetSaveBody) {
    if (!plan || !id) return
    const updatedBudget: Budget = budgetModal.budget
      ? { ...budgetModal.budget, ...body }
      : { id: nextTemporaryId('budget'), ...body, planId: id, templateId: null, template: null, transactions: [] }
    setPlan({
      ...plan,
      budgets: budgetModal.budget
        ? plan.budgets.map((budget) => budget.id === updatedBudget.id ? updatedBudget : budget)
        : [...plan.budgets, updatedBudget],
    })
    setBudgetModal({ open: false, budget: null })
  }

  async function deleteBudget(budget: Budget) {
    if (!plan) return
    setPlan({ ...plan, budgets: plan.budgets.filter((candidate) => candidate.id !== budget.id) })
  }

  function txBody(tx: Transaction): TxSaveBody {
    return {
      name: tx.name,
      plannedAmount: tx.plannedAmount,
      fromAccountId: tx.fromAccountId,
      toAccountId: tx.toAccountId,
      dueDateConfig: tx.dueDateConfig,
    }
  }

  async function saveChanges() {
    if (!plan || !originalPlan || !id) return
    setSavingChanges(true)
    try {
      const originalBudgets = new Map(originalPlan.budgets.map((budget) => [budget.id, budget]))
      const originalTransactions = new Map(
        [...originalPlan.transactions, ...originalPlan.budgets.flatMap((budget) => budget.transactions)]
          .map((tx) => [tx.id, tx]),
      )
      const draftTransactions = [...plan.transactions, ...plan.budgets.flatMap((budget) => budget.transactions)]
      const draftTransactionIds = new Set(draftTransactions.map((tx) => tx.id))
      const deletedBudgetIds = new Set(
        originalPlan.budgets.filter((budget) => !plan.budgets.some((draft) => draft.id === budget.id)).map((budget) => budget.id),
      )

      for (const tx of originalTransactions.values()) {
        if (!draftTransactionIds.has(tx.id) && !deletedBudgetIds.has(tx.budgetId ?? '')) {
          await apiClient.delete(`/api/transactions/${tx.id}`)
        }
      }
      for (const budget of plan.budgets) {
        const originalBudget = originalBudgets.get(budget.id)
        if (originalBudget && !sameSaveBody({ name: budget.name, amount: budget.amount }, { name: originalBudget.name, amount: originalBudget.amount })) {
          await apiClient.patch(`/api/budgets/${budget.id}`, { name: budget.name, amount: budget.amount })
        }
      }

      const budgetIds = new Map<string, string>()
      for (const budget of plan.budgets.filter((candidate) => isTemporaryId(candidate.id))) {
        const response = await apiClient.post<Budget>('/api/budgets', { name: budget.name, amount: budget.amount, planId: id })
        budgetIds.set(budget.id, response.data.id)
      }
      for (const tx of draftTransactions) {
        if (isTemporaryId(tx.id)) {
          await apiClient.post('/api/transactions', {
            ...txBody(tx), type: 'TRANSACTION',
            planId: tx.budgetId ? null : id,
            budgetId: tx.budgetId ? budgetIds.get(tx.budgetId) ?? tx.budgetId : null,
          })
          continue
        }
        const originalTx = originalTransactions.get(tx.id)
        if (originalTx && !sameSaveBody(txBody(tx), txBody(originalTx))) {
          await apiClient.patch(`/api/transactions/${tx.id}`, txBody(tx))
        }
      }
      for (const budgetId of deletedBudgetIds) {
        await apiClient.delete(`/api/budgets/${budgetId}`)
      }
      messageApi.success('Changes saved')
      await load()
      navigate('/plans', { state: returnState })
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string }
      messageApi.error(e?.response?.data?.message ?? e?.message ?? 'Save failed')
    } finally {
      setSavingChanges(false)
    }
  }

  function discardChanges() {
    if (!originalPlan) return
    setPlan(clonePlan(originalPlan))
    setTxModal({ open: false, tx: null, planId: null, budgetId: null })
    setBudgetModal({ open: false, budget: null })
    navigate('/plans', { state: returnState })
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><Spin size="large" /></div>
  if (error || !plan) return <Alert type="error" message={error ?? 'Plan not found'} showIcon />

  // Instances in terminal states cannot be modified
  const isLocked = !plan.isTemplate && (plan.statusCode === 3 || plan.statusCode === 4)
  const hasUnsavedChanges = !!originalPlan && JSON.stringify(plan) !== JSON.stringify(originalPlan)
  const effectiveName = plan.name ?? plan.template?.name ?? '(unnamed)'
  const accountMap = new Map(accounts.map((account) => [account.id, account]))

  function signedPlannedAmount(tx: Transaction): number {
    const fromAccount = tx.fromAccount ?? (tx.fromAccountId ? accountMap.get(tx.fromAccountId) : undefined)
      ?? (tx.template?.fromAccountId ? accountMap.get(tx.template.fromAccountId) : undefined)
    const toAccount = tx.toAccount ?? (tx.toAccountId ? accountMap.get(tx.toAccountId) : undefined)
      ?? (tx.template?.toAccountId ? accountMap.get(tx.template.toAccountId) : undefined)
    const amount = amountValue(tx.plannedAmount ?? tx.template?.plannedAmount)
    const kind = txKind(fromAccount?.type, toAccount?.type)
    if (kind === 'income') return amount
    if (kind === 'expense') return -amount
    return 0
  }

  const budgetExpense = plan.budgets.reduce(
    (total, budget) => total + amountValue(budget.amount ?? budget.template?.amount),
    0,
  )
  const transactionSummary = [...plan.transactions, ...plan.budgets.flatMap((budget) => budget.transactions)].reduce(
    (summary, tx) => {
      const amount = signedPlannedAmount(tx)
      if (amount > 0) summary.income += amount
      if (amount < 0) summary.expense += amount
      summary.total += amount
      return summary
    },
    { income: 0, expense: -budgetExpense, total: -budgetExpense },
  )
  const generalTotal = plan.transactions.reduce(
    (total, tx) => total + signedPlannedAmount(tx),
    0,
  )

  function handleBack() {
    if (hasUnsavedChanges) {
      setExitConfirmOpen(true)
      return
    }
    navigate('/plans', { state: returnState })
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {contextHolder}

      {/* Header */}
      <Space align="center" wrap>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={handleBack} />
        <Title level={4} style={{ margin: 0 }}>{effectiveName}</Title>
        <Tag color="purple">{plan.intervalType}</Tag>
        {plan.isTemplate
          ? <Tag color="volcano">TEMPLATE</Tag>
          : <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>}
        {plan.templateId && <Tag style={{ fontSize: 11 }}>Instance</Tag>}
        {hasUnsavedChanges && <Tag color="gold">Unsaved changes</Tag>}
      </Space>

      <Space size="large">
        <Text type="secondary">Income: <span style={{ color: '#3f8600' }}>{fmtAmount(String(transactionSummary.income))}</span></Text>
        <Text type="secondary">Expenses: <span style={{ color: '#cf1322' }}>{fmtAmount(String(transactionSummary.expense))}</span></Text>
        <Text type="secondary">Total: <span style={{ color: transactionSummary.total < 0 ? '#cf1322' : '#3f8600' }}>{fmtAmount(String(transactionSummary.total))}</span></Text>
      </Space>

      {isLocked && (
        <Alert
          type="warning"
          showIcon
          title={`This plan is ${STATUS_LABEL[plan.statusCode].toLowerCase()} and cannot be modified.`}
        />
      )}

      {/* Budgets */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Title level={5} style={{ margin: 0 }}>Budgets</Title>
          {!isLocked && (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setBudgetModal({ open: true, budget: null })}>
              Add Budget
            </Button>
          )}
        </div>
        <Collapse
          items={[
            {
              key: '__general__',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <Text strong>General</Text>
                  <Text style={{ marginLeft: 'auto', fontSize: 12, color: generalTotal < 0 ? '#cf1322' : '#3f8600' }}>
                    {fmtAmount(String(generalTotal))}
                  </Text>
                </div>
              ),
              children: (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    {plan.transactions.length > 0 && <Title level={5} style={{ margin: 0 }}>Transactions</Title>}
                    {!isLocked && plan.transactions.length > 0 && (
                      <Button size="small" icon={<PlusOutlined />} onClick={() => setTxModal({ open: true, tx: null, planId: id!, budgetId: null })}>
                        Add Transaction
                      </Button>
                    )}
                  </div>
                  {plan.transactions.length > 0 ? (
                    <TransactionTable
                      transactions={plan.transactions}
                      accounts={accounts}
                      isLocked={isLocked}
                      onEdit={(tx) => setTxModal({ open: true, tx, planId: tx.planId, budgetId: tx.budgetId })}
                      onDelete={deleteTx}
                    />
                  ) : (
                    <div style={{ minHeight: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Text type="secondary">There are no transactions yet.</Text>
                      {!isLocked && (
                        <Button size="small" icon={<PlusOutlined />} onClick={() => setTxModal({ open: true, tx: null, planId: id!, budgetId: null })}>
                          Add Transaction
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ),
            },
            ...plan.budgets.map((budget) => {
                const effectiveBudgetName = budget.name ?? budget.template?.name ?? '(unnamed)'
                const effectiveAmount = budget.amount ?? budget.template?.amount
                const amountIsInherited = !budget.amount && !!budget.template?.amount
                const budgetTotal = -amountValue(effectiveAmount) + budget.transactions.reduce(
                  (total, tx) => total + signedPlannedAmount(tx),
                  0,
                )
                return {
                  key: budget.id,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <Text strong style={{ flex: 1 }}>{effectiveBudgetName}</Text>
                      <Text style={{ fontSize: 12, color: budgetTotal < 0 ? '#cf1322' : '#3f8600', fontStyle: amountIsInherited ? 'italic' : undefined }}>
                          {fmtAmount(String(budgetTotal))}
                          {amountIsInherited && ' (inherited)'}
                      </Text>
                      {!isLocked && (
                        <>
                          <Button
                            size="small" type="text" icon={<EditOutlined />}
                            onClick={(e) => { e.stopPropagation(); setBudgetModal({ open: true, budget }) }}
                          />
                          <Popconfirm
                            title="Delete this budget and all its transactions?"
                            onConfirm={() => deleteBudget(budget)}
                            okText="Delete" okType="danger"
                            onPopupClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="small" type="text" danger icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Popconfirm>
                        </>
                      )}
                    </div>
                  ),
                  children: (
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        {budget.transactions.length > 0 && <Title level={5} style={{ margin: 0 }}>Transactions</Title>}
                        {!isLocked && budget.transactions.length > 0 && (
                          <Button
                            size="small" icon={<PlusOutlined />}
                            onClick={() => setTxModal({ open: true, tx: null, planId: null, budgetId: budget.id })}
                          >
                            Add Transaction
                          </Button>
                        )}
                      </div>
                      {budget.transactions.length > 0 ? (
                        <TransactionTable
                          transactions={budget.transactions}
                          accounts={accounts}
                          isLocked={isLocked}
                          onEdit={(tx) => setTxModal({ open: true, tx, planId: tx.planId, budgetId: tx.budgetId })}
                          onDelete={deleteTx}
                        />
                      ) : (
                        <div style={{ minHeight: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <Text type="secondary">There are no transactions yet.</Text>
                          {!isLocked && (
                            <Button
                              size="small" icon={<PlusOutlined />}
                              onClick={() => setTxModal({ open: true, tx: null, planId: null, budgetId: budget.id })}
                            >
                              Add Transaction
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                }
            }),
          ]}
        />
      </div>

      {/* Modals */}
      <TransactionModal
        open={txModal.open}
        tx={txModal.tx}
        accounts={accounts}
        planIntervalType={plan.intervalType}
        onOk={saveTx}
        onCancel={() => setTxModal({ open: false, tx: null, planId: null, budgetId: null })}
      />
      <BudgetModal
        open={budgetModal.open}
        budget={budgetModal.budget}
        onOk={saveBudget}
        onCancel={() => setBudgetModal({ open: false, budget: null })}
      />
      <Modal
        open={exitConfirmOpen}
        title="Unsaved changes"
        onCancel={() => setExitConfirmOpen(false)}
        closable={!savingChanges}
        maskClosable={!savingChanges}
        footer={[
          <Button key="continue" disabled={savingChanges} onClick={() => setExitConfirmOpen(false)}>Continue editing</Button>,
          <Button key="discard" danger disabled={savingChanges} onClick={discardChanges}>Discard changes</Button>,
          <Button key="save" type="primary" loading={savingChanges} onClick={saveChanges}>Save changes</Button>,
        ]}
      >
        <Text>You have unsaved changes. Save them before leaving?</Text>
      </Modal>
    </Space>
  )
}
