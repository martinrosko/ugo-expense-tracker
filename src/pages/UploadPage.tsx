import { useState } from 'react'
import { Upload, Table, Button, Typography, App as AntApp, Space } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { parseCSV } from '../features/csv/parseCSV'
import { matchTransactions } from '../features/matching/matcher'
import { fetchPartners } from '../api/partners'
import { fetchBudgets } from '../api/budgets'
import { fetchTags } from '../api/tags'
import type { BankTransaction } from '../features/csv/types'
import type { MatchedTransaction } from '../features/matching/matcher'

const { Dragger } = Upload
const { Title, Text } = Typography

const PREVIEW_COLUMNS = [
  { title: 'Date', dataIndex: 'date', key: 'date', width: 110 },
  { title: 'Description', dataIndex: 'description', key: 'description' },
  {
    title: 'Amount',
    dataIndex: 'amount',
    key: 'amount',
    width: 110,
    render: (v: number, row: BankTransaction) =>
      `${v.toFixed(2)} ${row.currency}`,
  },
]

export default function UploadPage() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  async function handleFile(file: File) {
    try {
      const parsed = await parseCSV(file)
      setTransactions(parsed)
      message.success(`Parsed ${parsed.length} transactions`)
    } catch {
      message.error('Failed to parse CSV. Check the file format.')
    }
    return false // prevent default upload behaviour
  }

  async function handleAnalyze() {
    if (transactions.length === 0) return
    setLoading(true)
    try {
      const [partners, budgets, tags] = await Promise.all([
        fetchPartners(),
        fetchBudgets(),
        fetchTags(),
      ])
      const matched: MatchedTransaction[] = matchTransactions(transactions, partners, budgets, tags)
      navigate('/review', { state: { matched } })
    } catch {
      message.error('Failed to load reference data from Resco Cloud.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
        <p className="ant-upload-hint">Supports your bank's standard export format.</p>
      </Dragger>

      {transactions.length > 0 && (
        <>
          <Text type="secondary">{transactions.length} rows parsed</Text>
          <Table
            dataSource={transactions}
            columns={PREVIEW_COLUMNS}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={{ pageSize: 20 }}
            scroll={{ x: true }}
          />
          <Button type="primary" onClick={handleAnalyze} loading={loading}>
            Analyze & Match
          </Button>
        </>
      )}
    </Space>
  )
}
