import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Table, Button, Select, Tag, Typography, Space, App as AntApp, Tooltip, Badge } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { createBankTicket } from '../api/bankTickets'
import { linkBankTicketToTransaction, createTransaction } from '../api/transactions'
import { createTransactionTag } from '../api/tags'
import type { MatchResult } from '../features/matching/types'
import type { RwTransaction, RwBudget, RwPlan, RwAccount, RwTag } from '../types/resco'

const { Title, Text } = Typography

interface EditableRow extends MatchResult {
  key: string
  selected: boolean
}

export default function ReviewPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  const state = location.state as {
    results: MatchResult[]
    transactions: RwTransaction[]
    budgets: RwBudget[]
    plans: RwPlan[]
    partners: RwAccount[]
    tags: RwTag[]
    accountId?: string
  } | null

  const [rows, setRows] = useState<EditableRow[]>(
    (state?.results ?? []).map((r, i) => ({ ...r, key: String(i), selected: !r.isDuplicate })),
  )
  const [submitting, setSubmitting] = useState(false)

  const budgets: RwBudget[] = state?.budgets ?? []
  const plans: RwPlan[] = state?.plans ?? []
  const partners: RwAccount[] = state?.partners ?? []
  const tags: RwTag[] = state?.tags ?? []
  const transactions: RwTransaction[] = state?.transactions ?? []

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleSubmit() {
    const selected = rows.filter((r) => r.selected && !r.isDuplicate)
    if (selected.length === 0) {
      message.warning('No rows selected (or all are duplicates).')
      return
    }
    setSubmitting(true)
    let successCount = 0
    for (const row of selected) {
      try {
        // 1. Create the bank ticket record
        const bt = await createBankTicket({
          name: `${row.csvRow.partnername} ${row.csvRow.executedon}`,
          rw_amount: row.csvRow.amount,
          rw_executedon: row.csvRow.executedon,
          rw_partnername: row.csvRow.partnername,
          rw_partneraccountnumber: row.csvRow.partneraccountnumber,
          rw_reference: row.csvRow.reference,
          rw_variablesymbol: row.csvRow.variablesymbol,
          rw_constantsymbol: row.csvRow.constantsymbol,
          rw_specificsymbol: row.csvRow.specificsymbol,
          rw_ticketid: row.csvRow.ticketid || undefined,
          accountId: state?.accountId,
        })

        let transactionId: string

        if (row.matchedTransaction) {
          // 2a. Link bank ticket to existing planned transaction
          await linkBankTicketToTransaction(
            row.matchedTransaction.id,
            bt.id!,
            row.csvRow.executedon,
          )
          transactionId = row.matchedTransaction.id
        } else {
          // 2b. Create a new realized transaction under the selected budget
          const budget = row.suggestedBudget
          if (!budget) {
            message.warning(`Row ${row.rowIndex + 1}: no budget selected, skipped.`)
            continue
          }
          const tx = await createTransaction({
            name: row.csvRow.partnername || row.csvRow.reference || 'Imported',
            rw_amount: row.csvRow.amount,
            rw_executedon: row.csvRow.executedon,
            bankTicketId: bt.id!,
            budgetId: budget.id,
            toAccountId: row.suggestedPartner?.id,
            rw_type: row.csvRow.amount < 0 ? 1 : 2,
          })
          transactionId = tx.id
        }

        // 3. Create tag associations
        for (const tag of row.suggestedTags) {
          await createTransactionTag(transactionId, tag.id)
        }

        successCount++
      } catch {
        message.error(`Row ${row.rowIndex + 1} failed — continuing with remaining rows.`)
      }
    }

    if (successCount > 0) {
      message.success(`${successCount} transaction(s) submitted successfully.`)
      navigate('/upload')
    }
    setSubmitting(false)
  }

  const columns: ColumnsType<EditableRow> = [
    {
      title: '',
      width: 40,
      render: (_, row) => (
        <input
          type="checkbox"
          checked={row.selected}
          disabled={row.isDuplicate}
          onChange={(e) => updateRow(row.key, { selected: e.target.checked })}
        />
      ),
    },
    {
      title: 'Status',
      width: 90,
      render: (_, row) => {
        if (row.isDuplicate) return <Tag color="red">Duplicate</Tag>
        if (row.matchedTransaction) return <Tag color="green">Matched</Tag>
        return <Tag color="orange">New</Tag>
      },
    },
    { title: 'Date', dataIndex: ['csvRow', 'executedon'], width: 105 },
    {
      title: 'Partner / Ref',
      render: (_, row) => (
        <div>
          <div>{row.csvRow.partnername}</div>
          {row.csvRow.reference && (
            <Text type="secondary" style={{ fontSize: 11 }}>{row.csvRow.reference}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Amount',
      width: 100,
      render: (_, row) => (
        <span style={{ color: row.csvRow.amount < 0 ? '#cf1322' : '#389e0d', fontWeight: 600 }}>
          {row.csvRow.amount.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Matched Transaction',
      width: 220,
      render: (_, row) => (
        <Select
          value={row.matchedTransaction?.id}
          placeholder="— create new —"
          allowClear
          style={{ width: '100%' }}
          options={transactions.map((tx) => ({ value: tx.id, label: tx.name }))}
          onChange={(val) => {
            const tx = transactions.find((t) => t.id === val)
            updateRow(row.key, {
              matchedTransaction: tx,
              matchedBudget: tx
                ? budgets.find((b) => b.id === tx.__rw_parentid_id)
                : undefined,
            })
          }}
        />
      ),
    },
    {
      title: 'Budget',
      width: 180,
      render: (_, row) => {
        const displayBudget = row.matchedBudget ?? row.suggestedBudget
        if (row.matchedTransaction) {
          // Read-only — determined by the matched transaction
          return <Text type="secondary">{displayBudget?.name ?? '—'}</Text>
        }
        return (
          <Select
            value={row.suggestedBudget?.id}
            placeholder="— select budget —"
            allowClear
            style={{ width: '100%' }}
            options={budgets.map((b) => {
              const plan = plans.find((p) => p.id === b.__rw_parentid_id)
              return { value: b.id, label: plan ? `${plan.name} › ${b.name}` : b.name }
            })}
            onChange={(val) =>
              updateRow(row.key, {
                suggestedBudget: budgets.find((b) => b.id === val),
              })
            }
          />
        )
      },
    },
    {
      title: 'Partner Acct',
      width: 180,
      render: (_, row) => (
        <Select
          value={row.suggestedPartner?.id}
          placeholder="— none —"
          allowClear
          style={{ width: '100%' }}
          options={partners.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(val) =>
            updateRow(row.key, {
              suggestedPartner: partners.find((p) => p.id === val),
            })
          }
        />
      ),
    },
    {
      title: 'Tags',
      width: 200,
      render: (_, row) => (
        <Select
          mode="multiple"
          value={row.suggestedTags.map((t) => t.id)}
          placeholder="— none —"
          style={{ width: '100%' }}
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(vals: string[]) =>
            updateRow(row.key, {
              suggestedTags: tags.filter((t) => vals.includes(t.id)),
            })
          }
        />
      ),
    },
    {
      title: 'Confidence',
      width: 100,
      render: (_, row) => {
        const pct = Math.round(row.confidence * 100)
        const color = pct >= 70 ? 'green' : pct >= 40 ? 'orange' : 'default'
        return (
          <Tooltip title={row.isDuplicate ? 'Already imported' : undefined}>
            {row.isDuplicate ? (
              <WarningOutlined style={{ color: '#faad14' }} />
            ) : (
              <Badge
                count={`${pct}%`}
                style={{ backgroundColor: color === 'green' ? '#52c41a' : color === 'orange' ? '#fa8c16' : '#d9d9d9', color: '#fff' }}
              />
            )}
          </Tooltip>
        )
      },
    },
  ]

  const selectedCount = rows.filter((r) => r.selected && !r.isDuplicate).length
  const duplicateCount = rows.filter((r) => r.isDuplicate).length

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Review Matches</Title>
      {duplicateCount > 0 && (
        <Text type="warning">
          <WarningOutlined /> {duplicateCount} row(s) already exist in Resco Cloud and are excluded.
        </Text>
      )}
      <Table
        dataSource={rows}
        columns={columns}
        rowKey="key"
        size="small"
        pagination={{ pageSize: 30 }}
        scroll={{ x: true }}
        rowClassName={(r) => (r.isDuplicate ? 'ant-table-row-disabled' : '')}
      />
      <Space>
        <Button onClick={() => navigate('/upload')}>Back</Button>
        <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={selectedCount === 0}>
          Submit {selectedCount > 0 ? `(${selectedCount})` : ''} selected
        </Button>
      </Space>
    </Space>
  )
}

