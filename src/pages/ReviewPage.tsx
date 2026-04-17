import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Table,
  Button,
  Select,
  Tag,
  Typography,
  Space,
  App as AntApp,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { createTransaction } from '../api/transactions'
import type { MatchedTransaction } from '../features/matching/matcher'
import type { PaymentPartner, Budget, Tag as RescoTag } from '../types/resco'

const { Title } = Typography

interface EditableMatch extends MatchedTransaction {
  key: string
  selected: boolean
}

export default function ReviewPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  const incoming: MatchedTransaction[] = location.state?.matched ?? []
  const [rows, setRows] = useState<EditableMatch[]>(
    incoming.map((m, i) => ({ ...m, key: String(i), selected: true })),
  )
  const [submitting, setSubmitting] = useState(false)

  function updateRow(key: string, patch: Partial<EditableMatch>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleSubmit() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) {
      message.warning('No rows selected.')
      return
    }
    setSubmitting(true)
    try {
      await Promise.all(
        selected.map((r) =>
          createTransaction({
            date: r.source.date,
            description: r.source.description,
            amount: r.source.amount,
            currency: r.source.currency,
            partnerId: r.suggestedPartner?.id,
            budgetId: r.suggestedBudget?.id,
            tagIds: r.suggestedTags.map((t) => t.id),
          }),
        ),
      )
      message.success(`${selected.length} transaction(s) submitted.`)
      navigate('/upload')
    } catch {
      message.error('Submission failed. Check your connection and credentials.')
    } finally {
      setSubmitting(false)
    }
  }

  const columns: ColumnsType<EditableMatch> = [
    {
      title: '',
      dataIndex: 'selected',
      width: 50,
      render: (val: boolean, row) => (
        <input
          type="checkbox"
          checked={val}
          onChange={(e) => updateRow(row.key, { selected: e.target.checked })}
        />
      ),
    },
    { title: 'Date', dataIndex: ['source', 'date'], width: 110 },
    { title: 'Description', dataIndex: ['source', 'description'] },
    {
      title: 'Amount',
      width: 120,
      render: (_, row) =>
        `${row.source.amount.toFixed(2)} ${row.source.currency}`,
    },
    {
      title: 'Partner',
      width: 200,
      render: (_, row) => (
        <Select
          value={row.suggestedPartner?.id}
          placeholder="— none —"
          allowClear
          style={{ width: '100%' }}
          options={(location.state?.partners as PaymentPartner[] | undefined ?? []).map(
            (p: PaymentPartner) => ({ value: p.id, label: p.name }),
          )}
          onChange={(val) =>
            updateRow(row.key, {
              suggestedPartner: (location.state?.partners as PaymentPartner[] | undefined ?? []).find(
                (p: PaymentPartner) => p.id === val,
              ),
            })
          }
        />
      ),
    },
    {
      title: 'Budget',
      width: 200,
      render: (_, row) => (
        <Select
          value={row.suggestedBudget?.id}
          placeholder="— none —"
          allowClear
          style={{ width: '100%' }}
          options={(location.state?.budgets as Budget[] | undefined ?? []).map(
            (b: Budget) => ({ value: b.id, label: b.name }),
          )}
          onChange={(val) =>
            updateRow(row.key, {
              suggestedBudget: (location.state?.budgets as Budget[] | undefined ?? []).find(
                (b: Budget) => b.id === val,
              ),
            })
          }
        />
      ),
    },
    {
      title: 'Tags',
      render: (_, row) => (
        <Select
          mode="multiple"
          value={row.suggestedTags.map((t) => t.id)}
          placeholder="— none —"
          style={{ width: '100%' }}
          options={(location.state?.tags as RescoTag[] | undefined ?? []).map(
            (t: RescoTag) => ({ value: t.id, label: t.name }),
          )}
          onChange={(vals: string[]) =>
            updateRow(row.key, {
              suggestedTags: (location.state?.tags as RescoTag[] | undefined ?? []).filter(
                (t: RescoTag) => vals.includes(t.id),
              ),
            })
          }
        />
      ),
    },
    {
      title: 'Confidence',
      width: 110,
      render: (_, row) => (
        <Tag color={row.confidence === 1 ? 'green' : row.confidence > 0 ? 'orange' : 'default'}>
          {Math.round(row.confidence * 100)}%
        </Tag>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Review Matches</Title>
      <Table
        dataSource={rows}
        columns={columns}
        size="small"
        pagination={{ pageSize: 30 }}
        scroll={{ x: true }}
      />
      <Space>
        <Button onClick={() => navigate('/upload')}>Back</Button>
        <Button type="primary" onClick={handleSubmit} loading={submitting}>
          Submit selected
        </Button>
      </Space>
    </Space>
  )
}
