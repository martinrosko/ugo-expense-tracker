import { useState } from 'react'
import { Upload, Table, Button, Typography, App as AntApp, Space, Select } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import apiClient from '../api/apiClient'
import { parseCSV } from '../features/csv/parseCSV'
import { matchAll } from '../features/matching/matcher'
import { targetKey } from '../features/matching/rules'
import type { Candidate, TagRef, Target } from '../features/matching/types'
import { planLabel } from '../features/planLabel'
import { apiError, resolveAll, type RawPlan, type Tx } from '../features/planTransactions'
import type { CsvRow } from '../features/csv/types'

const { Dragger } = Upload
const { Title, Text } = Typography

type AccountItem = { id: string; name: string; type: string; isDefault?: boolean }

type PlanItem = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  templateIntervalType?: string | null
  isTemplate: boolean
  statusCode: number
}

const PREVIEW_COLUMNS = [
  { title: 'Date', dataIndex: 'executedon', key: 'executedon', width: 110 },
  { title: 'Partner', dataIndex: 'partnername', key: 'partnername' },
  { title: 'Reference', dataIndex: 'reference', key: 'reference' },
  {
    title: 'Amount',
    dataIndex: 'amount',
    key: 'amount',
    width: 110,
    render: (v: number) => (
      <span style={{ color: v < 0 ? '#cf1322' : '#389e0d' }}>
        {v.toFixed(2)}
      </span>
    ),
  },
]

export default function UploadPage() {
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [bankAccounts, setBankAccounts] = useState<AccountItem[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  async function handleFile(file: File) {
    try {
      const parsed = await parseCSV(file)
      setCsvRows(parsed)
      message.success(`Parsed ${parsed.length} rows`)
      if (bankAccounts.length === 0) {
        const res = await apiClient.get<AccountItem[]>('/api/accounts')
        const banks = res.data.filter((a) => a.type === 'BANK')
        setBankAccounts(banks)
        const def = banks.find((a) => a.isDefault) ?? banks[0]
        if (def) setSelectedAccountId(def.id)
      }
    } catch {
      message.error('Failed to parse CSV. Check the file format.')
    }
    return false
  }

  async function handleAnalyze() {
    if (csvRows.length === 0) return
    if (!selectedAccountId) {
      message.warning('Select the bank account this CSV belongs to.')
      return
    }
    setLoading(true)
    try {
      // Completed plans are limited to the period covered by the CSV
      const dates = csvRows.map((r) => r.executedon).filter(Boolean).sort()
      const [active, completed, accountsRes, tagsRes, ticketsRes] = await Promise.all([
        apiClient.get<PlanItem[]>('/api/plans', { params: { status: '1', isTemplate: 'false' } }),
        apiClient.get<PlanItem[]>('/api/plans', { params: { status: '3', isTemplate: 'false', from: dates[0], to: dates[dates.length - 1] } }),
        apiClient.get<AccountItem[]>('/api/accounts'),
        apiClient.get<TagRef[]>('/api/tags'),
        apiClient.get<{ ticketId: string | null }[]>('/api/bank-tickets', { params: { accountId: selectedAccountId } }),
      ])

      // Newest plan first, which is the order the partner history is searched in
      const planItems = [...active.data, ...completed.data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
      const details = await Promise.all(planItems.map((p) => apiClient.get<RawPlan>(`/api/plans/${p.id}`)))
      const accountMap = new Map(accountsRes.data.map((a) => [a.id, a]))

      const candidates: Candidate[] = []
      const targets: Target[] = []
      const history: { tx: Tx; target: Target }[] = []
      planItems.forEach((item, i) => {
        const plan = details[i].data
        const label = planLabel(item)
        const completedPlan = item.statusCode === 3
        const planTargets: Target[] = [
          {
            key: targetKey(plan.id, null), planId: plan.id, budgetId: null, budgetName: null,
            label: `${label} › General`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
          },
          ...plan.budgets.map((b) => {
            const budgetName = b.name ?? b.template?.name ?? '(unnamed)'
            return {
              key: targetKey(plan.id, b.id), planId: plan.id, budgetId: b.id, budgetName,
              label: `${label} › ${budgetName}`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
            }
          }),
        ]
        targets.push(...planTargets)
        const txs = resolveAll(plan, accountMap)
        for (const tx of txs) {
          const target = planTargets.find((t) => t.budgetId === tx.budgetId)
          if (target) history.push({ tx, target })
          if (item.statusCode === 1 && !tx.executedOn && !tx.budgetCompleted) candidates.push({ ...tx, planId: plan.id, planLabel: label })
        }
      })

      const partners = accountsRes.data.filter((a) => a.type === 'PAYMENT_PARTNER')
      const known = new Set(ticketsRes.data.map((t) => t.ticketId).filter(Boolean))
      const results = matchAll(csvRows, candidates, partners, tagsRes.data, history, targets)
        .map((r) => ({ ...r, isDuplicate: !!r.csvRow.ticketid && known.has(r.csvRow.ticketid) }))

      navigate('/review', {
        state: { results, candidates, targets, partners, accounts: accountsRes.data, tags: tagsRes.data, accountId: selectedAccountId },
      })
    } catch (err) {
      message.error(apiError(err, 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Upload Bank CSV</Title>

      <Dragger
        accept=".csv"
        beforeUpload={handleFile}
        showUploadList={false}
        style={{ padding: '24px' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a CSV file here</p>
        <p className="ant-upload-hint">Supports your bank's standard CSV export format.</p>
      </Dragger>

      {csvRows.length > 0 && (
        <>
          <Text type="secondary">{csvRows.length} rows parsed</Text>

          {bankAccounts.length > 0 && (
            <div>
              <Text strong style={{ marginRight: 8 }}>Bank account in this CSV:</Text>
              <Select
                style={{ width: 280 }}
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          )}

          <Table
            dataSource={csvRows}
            columns={PREVIEW_COLUMNS}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={{ pageSize: 20 }}
            scroll={{ x: true }}
          />
          <Button type="primary" onClick={handleAnalyze} loading={loading}>
            Analyze &amp; Match
          </Button>
        </>
      )}
    </Space>
  )
}
