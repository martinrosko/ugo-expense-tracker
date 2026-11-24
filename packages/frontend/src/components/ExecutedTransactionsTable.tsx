import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Input, InputNumber, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FilterOutlined, LinkOutlined } from '@ant-design/icons'
import RowActions, { type RowAction } from './RowActions'
import { rowClickAction } from '../features/usePlanTxActions'

const { Text } = Typography

export type ExecutedTxRow = {
  id: string
  executedOn: string | Date | null
  name: string | null
  /** Instance of a template transaction */
  hasTemplate?: boolean
  hasBankTicket?: boolean
  from?: string | null
  to?: string | null
  plan?: string | null
  budget?: string | null
  amount: number | null
  /** Colors the amount: expense red, income green, transfer neutral */
  kind: 'income' | 'expense' | 'transfer'
  tags?: { id: string; name: string; color?: string | null }[]
}

type Props = {
  rows: ExecutedTxRow[]
  /** Label of the list, shown with the filter button above it */
  title?: ReactNode
  /** Shows plan and budget tags, or the budget tag only */
  scope?: 'planAndBudget' | 'budget'
  /** Shows the tags under the name and offers a tag filter */
  showTags?: boolean
  /** Adds the actions column; clicking a row runs its edit action */
  actionsFor?: (row: ExecutedTxRow) => RowAction[]
  defaultPageSize?: number
  pageSizeOptions?: number[]
  /** Changing it returns to the first page */
  resetKey?: unknown
  emptyText?: string
  /** Receives the rows of the current page and how many columns to span before and after the amount column */
  summary?: (rows: readonly ExecutedTxRow[], span: { label: number; trailing: number }) => ReactNode
}

type SortKey = 'date' | 'name' | 'account' | 'scope' | 'amount'
type Sort = { key: SortKey; order: 'ascend' | 'descend' }
type Filters = { name: string; accounts: string[]; scopes: string[]; tags: string[]; min: number | null; max: number | null }

const NO_FILTERS: Filters = { name: '', accounts: [], scopes: [], tags: [], min: null, max: null }
const AMOUNT_COLOR = { income: '#3f8600', expense: '#cf1322', transfer: undefined }

const fmtMoney = (v: number | null) =>
  v === null ? '\u2014' : (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ac'

const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('sk-SK') : '\u2014')

const text = (a?: string | null, b?: string | null) => (a ?? '').localeCompare(b ?? '')
const time = (d: string | Date | null) => new Date(d ?? 0).getTime()
const distinct = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
const options = (values: string[]) => values.map((v) => ({ value: v, label: v }))

const COMPARE: Record<SortKey, (a: ExecutedTxRow, b: ExecutedTxRow) => number> = {
  date: (a, b) => time(a.executedOn) - time(b.executedOn),
  name: (a, b) => text(a.name, b.name),
  account: (a, b) => text(`${a.from} ${a.to}`, `${b.from} ${b.to}`),
  scope: (a, b) => text(`${a.plan ?? ''} ${a.budget ?? ''}`, `${b.plan ?? ''} ${b.budget ?? ''}`),
  amount: (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
}

/**
 * List of executed transactions with paging, a name column that also shows the accounts, optional plan/budget and tag columns,
 * row actions and a summary. A collapsible panel next to the title filters the rows and sets the sorting.
 */
export default function ExecutedTransactionsTable({
  rows, title, scope, showTags, actionsFor, defaultPageSize = 20, pageSizeOptions, resetKey, emptyText = 'No executed transactions', summary,
}: Props) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [panelOpen, setPanelOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort | null>({ key: 'date', order: 'ascend' })
  useEffect(() => setPage(1), [resetKey])

  const accountNames = useMemo(() => distinct(rows.flatMap((r) => [r.from, r.to])), [rows])
  const scopeNames = useMemo(() => distinct(rows.flatMap((r) => (scope === 'planAndBudget' ? [r.plan, r.budget] : [r.budget]))), [rows, scope])
  const tagNames = useMemo(() => distinct(rows.flatMap((r) => (r.tags ?? []).map((t) => t.name))), [rows])

  const visible = useMemo(() => {
    const needle = filters.name.trim().toLowerCase()
    const shown = rows.filter((r) =>
      (!needle || (r.name ?? '').toLowerCase().includes(needle)) &&
      (filters.accounts.length === 0 || filters.accounts.some((a) => r.from === a || r.to === a)) &&
      (filters.scopes.length === 0 || filters.scopes.some((s) => r.budget === s || (scope === 'planAndBudget' && r.plan === s))) &&
      (filters.tags.length === 0 || (r.tags ?? []).some((t) => filters.tags.includes(t.name))) &&
      (filters.min === null || (r.amount ?? 0) >= filters.min) &&
      (filters.max === null || (r.amount ?? 0) <= filters.max))
    if (!sort) return shown
    const compare = COMPARE[sort.key]
    return [...shown].sort((a, b) => (sort.order === 'ascend' ? compare(a, b) : -compare(a, b)))
  }, [rows, filters, sort, scope])

  const activeFilters = (filters.name.trim() ? 1 : 0) + (filters.accounts.length ? 1 : 0) + (filters.scopes.length ? 1 : 0) + (filters.tags.length ? 1 : 0) + (filters.min !== null || filters.max !== null ? 1 : 0)
  const change = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1) }
  const sortOf = (key: SortKey) => (sort?.key === key ? sort.order : null)

  const columns: ColumnsType<ExecutedTxRow> = [
    { title: 'Date', key: 'date', width: 90, sorter: true, sortOrder: sortOf('date'), render: (_, r) => fmtDate(r.executedOn) },
    {
      title: 'Name',
      key: 'name',
      ellipsis: true,
      sorter: true,
      sortOrder: sortOf('name'),
      render: (_, r) => (
        <div>
          <Space size={4}>
            {r.name ?? <Text type="secondary">(unnamed)</Text>}
            {r.hasTemplate && <Tag style={{ fontSize: 11 }}>template</Tag>}
            {r.hasBankTicket && <LinkOutlined style={{ color: '#1677ff' }} title="Linked to a bank ticket" />}
          </Space>
          <div style={{ fontSize: 11, lineHeight: 1.3, color: '#8c8c8c' }}>{`${r.from ?? '?'} \u2192 ${r.to ?? '?'}`}</div>
          {showTags && (r.tags ?? []).length > 0 && (
            <Space size={2} wrap style={{ marginTop: 2 }}>
              {(r.tags ?? []).map((t) => <Tag key={t.id} color={t.color ?? undefined} style={{ margin: 0, fontSize: 11, lineHeight: '16px' }}>{t.name}</Tag>)}
            </Space>
          )}
        </div>
      ),
    },
    ...(scope
      ? [{
          title: scope === 'budget' ? 'Budget' : 'Plan / Budget',
          key: 'scope',
          ellipsis: true,
          width: 180,
          sorter: true,
          sortOrder: sortOf('scope'),
          render: (_: unknown, r: ExecutedTxRow) => (
            <Space size={4}>
              {scope === 'planAndBudget' && r.plan && <Tag style={{ margin: 0 }}>{r.plan}</Tag>}
              {r.budget && <Tag color="blue" style={{ margin: 0 }}>{r.budget}</Tag>}
            </Space>
          ),
        }]
      : []),
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right',
      sorter: true,
      sortOrder: sortOf('amount'),
      render: (_, r) => <span style={{ color: AMOUNT_COLOR[r.kind], fontWeight: 600 }}>{fmtMoney(r.amount)}</span>,
    },
    ...(actionsFor
      ? [{
          title: '',
          key: 'actions',
          width: 60,
          align: 'right' as const,
          render: (_: unknown, r: ExecutedTxRow) => {
            const actions = actionsFor(r)
            return actions.length > 0 ? <RowActions actions={actions} /> : null
          },
        }]
      : []),
  ]

  const trailing = actionsFor ? 1 : 0
  // In a narrow container the table scrolls sideways instead of squeezing the name column to nothing
  const minWidth = columns.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 240), 0)
  const sortChoices: { value: SortKey; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
    { value: 'account', label: 'Accounts' },
    ...(scope ? [{ value: 'scope' as const, label: scope === 'budget' ? 'Budget' : 'Plan / Budget' }] : []),
    { value: 'amount', label: 'Amount' },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 8 }} align="center">
        {title ?? <Text strong>{`${visible.length} transaction${visible.length === 1 ? '' : 's'}`}</Text>}
        <Badge count={activeFilters} size="small">
          <Button size="small" type={panelOpen ? 'primary' : 'default'} icon={<FilterOutlined />} onClick={() => setPanelOpen((o) => !o)} title="Filter and sort" />
        </Badge>
        {visible.length !== rows.length && <Text type="secondary">{`${visible.length} of ${rows.length}`}</Text>}
      </Space>

      {panelOpen && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 8, background: '#fafafa' }}>
          <Space size={[12, 8]} wrap align="start">
            <Input allowClear placeholder={'Name contains\u2026'} style={{ width: 200 }} value={filters.name} onChange={(e) => change({ name: e.target.value })} />
            <Select mode="multiple" allowClear showSearch maxTagCount="responsive" placeholder="Accounts" style={{ minWidth: 220 }} options={options(accountNames)} value={filters.accounts} onChange={(accounts) => change({ accounts })} />
            {scope && (
              <Select mode="multiple" allowClear showSearch maxTagCount="responsive" placeholder={scope === 'budget' ? 'Budgets' : 'Plans / budgets'} style={{ minWidth: 220 }} options={options(scopeNames)} value={filters.scopes} onChange={(scopes) => change({ scopes })} />
            )}
            {showTags && (
              <Select mode="multiple" allowClear showSearch maxTagCount="responsive" placeholder="Tags" style={{ minWidth: 200 }} options={options(tagNames)} value={filters.tags} onChange={(tags) => change({ tags })} />
            )}
            <Space size={4}>
              <InputNumber placeholder="Min amount" style={{ width: 120 }} value={filters.min} onChange={(min) => change({ min })} />
              <Text type="secondary">{'\u2013'}</Text>
              <InputNumber placeholder="Max amount" style={{ width: 120 }} value={filters.max} onChange={(max) => change({ max })} />
            </Space>
          </Space>
          <Space size={12} wrap style={{ marginTop: 8 }}>
            <Text type="secondary">Sort by</Text>
            <Select style={{ width: 150 }} allowClear placeholder="None" options={sortChoices} value={sort?.key} onChange={(key?: SortKey) => setSort(key ? { key, order: sort?.order ?? 'ascend' } : null)} />
            <Radio.Group
              optionType="button"
              size="small"
              disabled={!sort}
              value={sort?.order ?? 'ascend'}
              onChange={(e) => sort && setSort({ ...sort, order: e.target.value })}
              options={[{ value: 'ascend', label: 'Ascending' }, { value: 'descend', label: 'Descending' }]}
            />
            {activeFilters > 0 && <Button size="small" type="link" onClick={() => change(NO_FILTERS)}>Clear filters</Button>}
          </Space>
        </div>
      )}

      <Table<ExecutedTxRow>
        size="small"
        rowKey="id"
        dataSource={visible}
        columns={columns}
        scroll={{ x: minWidth }}
        locale={{ emptyText }}
        onChange={(_p, _f, sorter, extra) => {
          if (extra.action === 'sort') {
            const one = Array.isArray(sorter) ? sorter[0] : sorter
            setSort(one?.order && one.columnKey ? { key: one.columnKey as SortKey, order: one.order } : null)
          }
          if (extra.action !== 'paginate') setPage(1)
        }}
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions,
          hideOnSinglePage: true,
          onChange: (p, s) => { setPage(p); setPageSize(s) },
        }}
        onRow={(r) => {
          const click = actionsFor ? rowClickAction(actionsFor(r), true) : undefined
          return click ? { onClick: () => void click.onClick(), style: { cursor: 'pointer' } } : {}
        }}
        summary={summary ? (data) => summary(data, { label: columns.length - 1 - trailing, trailing }) : undefined}
      />
    </div>
  )
}
