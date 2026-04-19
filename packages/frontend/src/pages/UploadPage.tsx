import { useState } from 'react'
import { Upload, Table, Button, Typography, App as AntApp, Space, Select } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { parseCSV } from '../features/csv/parseCSV'
import { matchAll } from '../features/matching/matcher'
import { fetchUserAccounts, fetchPaymentPartners } from '../api/accounts'
import { fetchActivePlans } from '../api/plans'
import { fetchBudgets } from '../api/budgets'
import { fetchUnmatchedTransactions } from '../api/transactions'
import { fetchTags } from '../api/tags'
import type { CsvRow } from '../features/csv/types'
import type { RwAccount } from '../types/resco'

const { Dragger } = Upload
const { Title, Text } = Typography

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
  const [userAccounts, setUserAccounts] = useState<RwAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  async function handleFile(file: File) {
    try {
      const parsed = await parseCSV(file)
      setCsvRows(parsed)
      message.success(`Parsed ${parsed.length} rows`)
      // Load bank accounts for the account selector
      if (userAccounts.length === 0) {
        const accounts = await fetchUserAccounts()
        setUserAccounts(accounts)
        const def = accounts.find((a) => a.rw_isdefault)
        if (def) setSelectedAccountId(def.id)
      }
    } catch {
      message.error('Failed to parse CSV. Check the file format.')
    }
    return false
  }

  async function handleAnalyze() {
    if (csvRows.length === 0) return
    setLoading(true)
    try {
      // 1. Fetch active plans and their budgets
      const plans = await fetchActivePlans()
      const planIds = plans.map((p) => p.id)
      const budgets = await fetchBudgets(planIds)
      const budgetIds = budgets.map((b) => b.id)

      // 2. Fetch unmatched planned transactions + reference data
      const [transactions, partners, tags] = await Promise.all([
        fetchUnmatchedTransactions([...planIds, ...budgetIds]),
        fetchPaymentPartners(),
        fetchTags(),
      ])

      // 3. Run matching engine
      const results = matchAll(csvRows, transactions, budgets, plans, partners, tags)

      navigate('/review', {
        state: { results, transactions, budgets, plans, partners, tags, accountId: selectedAccountId },
      })
    } catch {
      message.error('Failed to load data from Resco Cloud. Check your .env.local credentials.')
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

          {userAccounts.length > 0 && (
            <div>
              <Text strong style={{ marginRight: 8 }}>Bank account in this CSV:</Text>
              <Select
                style={{ width: 280 }}
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                options={userAccounts.map((a) => ({ value: a.id, label: a.name }))}
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

