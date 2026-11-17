import { useEffect, useRef, useState } from 'react'
import { Table, Button, Select, Tag, Typography, Space, App as AntApp, Tooltip, Badge, Checkbox, Spin, Upload } from 'antd'
import { WarningOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { SelectProps } from 'antd'
import axios from 'axios'
import apiClient from '../api/apiClient'
import TransactionModal, { type TxModalBody, type TxModalTx } from '../components/TransactionModal'
import { TagsField } from '../components/TagPicker'
import { parseCSV } from '../features/csv/parseCSV'
import type { CsvRow } from '../features/csv/types'
import { analyzeCsv, type Analysis } from '../features/matching/analyze'
import type { Candidate, MatchResult } from '../features/matching/types'
import { rankCandidates, rankTargets, targetKey, TIER_LABELS } from '../features/matching/rules'
import { apiError, type AccountRef } from '../features/planTransactions'

const { Title, Text } = Typography
const { Dragger } = Upload

type BankAccount = { id: string; name: string; type: string; isDefault?: boolean }

/** Values the user filled in through the details dialog; they win over the CSV and the matched transaction. */
type RowDetails = {
  name: string | null
  amount: number | null
  fromAccountId: string | null
  toAccountId: string | null
  executedOn: string
}

interface EditableRow extends MatchResult {
  key: string
  selected: boolean
  details?: RowDetails
  /** Once the user edited the tags they are no longer prefilled */
  tagsTouched?: boolean
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('sk-SK') : 'no date')
const fmtAmount = (v: number | null) => (v === null ? '' : ` · ${v.toFixed(2)} €`)

function ReviewTable({ state, onDone, onDiscard }: { state: Analysis; onDone: () => void; onDiscard: () => void }) {
  const { message } = AntApp.useApp()

  const [rows, setRows] = useState<EditableRow[]>(
    state.results.map((r, i) => ({ ...r, key: String(i), selected: !r.isDuplicate })),
  )
  const [submitting, setSubmitting] = useState(false)
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const [hideDuplicates, setHideDuplicates] = useState(false)

  const { candidates, targets, tags } = state
  const [createdPartners, setCreatedPartners] = useState<{ id: string; name: string; type: string }[]>([])
  const partners = [...state.partners, ...createdPartners]
  const allAccounts = [...state.accounts, ...createdPartners]

  const ruleTags = useRef(new Map(state.results.map((r, i) => [String(i), r.tags])))
  const appliedSignature = useRef(new Map<string, string>())

  // Matched rows get the tags of the planned transaction (or its template); new ones those of plan, budget and accounts
  useEffect(() => {
    for (const row of rows) {
      if (row.isDuplicate || row.tagsTouched) continue
      const acc = rowAccounts(row)
      const signature = [row.matched?.id, row.target?.planId, row.target?.budgetId, acc.from, acc.to].join('|')
      if (appliedSignature.current.get(row.key) === signature) continue
      appliedSignature.current.set(row.key, signature)
      void defaultTagIds(row, acc).then((ids) => {
        const wanted = new Set([...(ruleTags.current.get(row.key) ?? []).map((t) => t.id), ...ids])
        setRows((prev) => prev.map((r) => (r.key === row.key && !r.tagsTouched ? { ...r, tags: tags.filter((t) => wanted.has(t.id)) } : r)))
      })
    }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  async function defaultTagIds(row: EditableRow, acc: { from: string | null; to: string | null }): Promise<string[]> {
    try {
      if (row.matched) {
        const own = await fetchTransactionTagIds(row.matched.id)
        return own.length === 0 && !row.matched.executedOn && row.matched.templateId ? await fetchTransactionTagIds(row.matched.templateId) : own
      }
      const res = await apiClient.get<{ id: string }[]>('/api/tags/union', {
        params: {
          planId: row.target?.planId,
          budgetId: row.target?.budgetId ?? undefined,
          accountIds: [acc.from, acc.to].filter(Boolean).join(',') || undefined,
        },
      })
      return res.data.map((t) => t.id)
    } catch {
      return []
    }
  }

  async function fetchTransactionTagIds(id: string): Promise<string[]> {
    const res = await apiClient.get<{ tags?: { tag: { id: string } }[] }>(`/api/transactions/${id}`)
    return (res.data.tags ?? []).map((t) => t.tag.id)
  }

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const defaultExecutedOn = (row: EditableRow) => new Date(`${row.csvRow.executedon}T12:00:00`).toISOString()

  /** Accounts of a matched transaction, with a wrongly logged own (non-partner) account on the bank side replaced by the imported bank account. */
  function matchedAccounts(m: Candidate, amount: number): { from: string | null; to: string | null; fixed: AccountRef | null } {
    const bank = state.accountId
    const wrong = (side: AccountRef | null, other: AccountRef | null) =>
      !!side && side.id !== bank && side.type !== 'PAYMENT_PARTNER' && other?.id !== bank
    const from = m.from?.id ?? null
    const to = m.to?.id ?? null
    if (amount < 0 && wrong(m.from, m.to)) return { from: bank, to, fixed: m.from }
    if (amount >= 0 && wrong(m.to, m.from)) return { from, to: bank, fixed: m.to }
    return { from, to, fixed: null }
  }

  /** From/to account ids the transaction will get: dialog values, else the matched transaction's, else bank account and partner. */
  function rowAccounts(row: EditableRow): { from: string | null; to: string | null } {
    if (row.details) return { from: row.details.fromAccountId, to: row.details.toAccountId }
    if (row.matched) return matchedAccounts(row.matched, row.csvRow.amount)
    const bank = state.accountId
    const partner = row.partner?.id ?? null
    return row.csvRow.amount < 0 ? { from: bank, to: partner } : { from: partner, to: bank }
  }

  function modalTxFor(row: EditableRow): TxModalTx {
    const acc = rowAccounts(row)
    const byId = (id: string | null) => (id ? allAccounts.find((a) => a.id === id) ?? null : null)
    return {
      name: row.details ? row.details.name : row.matched?.name ?? (row.csvRow.partnername || row.csvRow.reference || null),
      plannedAmount: String(row.details?.amount ?? Math.abs(row.csvRow.amount)),
      fromAccountId: acc.from,
      toAccountId: acc.to,
      fromAccount: byId(acc.from),
      toAccount: byId(acc.to),
      dueDateConfig: null,
      executedOn: row.details?.executedOn ?? defaultExecutedOn(row),
    }
  }

  async function applyDetails(body: TxModalBody) {
    const ids = body.tagIds ?? []
    updateRow(detailsKey!, {
      details: {
        name: body.name,
        amount: body.plannedAmount != null ? Number(body.plannedAmount) : null,
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        executedOn: body.executedOn!,
      },
      tags: tags.filter((t) => ids.includes(t.id)),
      tagsTouched: true,
    })
    setDetailsKey(null)
  }

  async function handleSubmit() {
    const selected = rows.filter((r) => r.selected && !r.isDuplicate)
    if (selected.length === 0) {
      message.warning('No rows selected (or all are duplicates).')
      return
    }
    if (!state.accountId) {
      message.error('No bank account selected.')
      return
    }
    setSubmitting(true)
    let successCount = 0
    for (const row of selected) {
      const csv = row.csvRow
      try {
        if (!row.matched && !row.target) {
          message.warning(`Row ${row.rowIndex + 1}: no plan/budget selected, skipped.`)
          continue
        }

        const ticketRes = await apiClient.post<{ id: string }[]>('/api/bank-tickets', {
          accountId: state.accountId,
          ticketId: csv.ticketid || undefined,
          name: `${csv.partnername} ${csv.executedon}`.trim(),
          amount: csv.amount,
          executedOn: csv.executedon,
          partnerName: csv.partnername,
          partnerAccountNumber: csv.partneraccountnumber,
          reference: csv.reference,
          variableSymbol: csv.variablesymbol,
          constantSymbol: csv.constantsymbol,
          specificSymbol: csv.specificsymbol,
        })
        const bankTicketId = ticketRes.data[0].id
        const executedOn = row.details?.executedOn ?? defaultExecutedOn(row)
        const amount = row.details?.amount ?? Math.abs(csv.amount)
        const tagIds = row.tags.map((t) => t.id)
        const acc = rowAccounts(row)

        if (row.matched) {
          const m = row.matched
          const id = m.id
          if (m.executedOn) {
            // Already logged by hand: only link the bank ticket, keeping its date and amount unless edited in the dialog
            await apiClient.patch(`/api/transactions/${id}`, {
              bankTicketId,
              ...(row.details
                ? { executedOn, amount, name: row.details.name ?? undefined, fromAccountId: acc.from, toAccountId: acc.to }
                : {
                    fromAccountId: acc.from !== (m.from?.id ?? null) ? acc.from : undefined,
                    toAccountId: acc.to !== (m.to?.id ?? null) ? acc.to : undefined,
                  }),
            })
          } else {
            // Only values that differ from the planned transaction become overrides
            await apiClient.post(`/api/transactions/${id}/execute`, {
              executedOn,
              amount,
              name: row.details?.name && row.details.name !== m.name ? row.details.name : undefined,
              fromAccountId: acc.from && acc.from !== m.from?.id ? acc.from : undefined,
              toAccountId: acc.to && acc.to !== m.to?.id ? acc.to : undefined,
            })
            await apiClient.patch(`/api/transactions/${id}`, { bankTicketId })
          }
          // Added one by one so the tags the planned transaction already has are kept
          for (const tagId of tagIds) {
            await apiClient.post(`/api/transactions/${id}/tags`, { tagId }).catch((err) => {
              if (!(axios.isAxiosError(err) && err.response?.status === 409)) throw err
            })
          }
        } else {
          const target = row.target!
          await apiClient.post('/api/transactions', {
            name: row.details?.name ?? (csv.partnername || csv.reference || 'Imported'),
            amount,
            executedOn,
            type: 'TRANSACTION',
            fromAccountId: acc.from,
            toAccountId: acc.to,
            budgetId: target.budgetId,
            planId: target.budgetId ? null : target.planId,
            bankTicketId,
            tagIds,
            statusCode: target.completed ? 3 : 1,
            stateCode: target.completed ? 1 : 0,
          })
        }
        successCount++
      } catch (err) {
        message.error(`Row ${row.rowIndex + 1} failed: ${apiError(err, 'unknown error')}. Continuing with remaining rows.`)
      }
    }

    if (successCount > 0) {
      message.success(`${successCount} transaction(s) submitted successfully.`)
      onDone()
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
      width: 120,
      render: (_, row) => {
        if (row.isDuplicate) return <Tag color="red">Duplicate</Tag>
        if (row.matched) return <Tag color="green">Matched</Tag>
        return (
          <Tooltip title="A new transaction will be created. Review it, or untick the row to discard it.">
            <Tag color="orange">New – review</Tag>
          </Tooltip>
        )
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
      title: 'Plan / Budget',
      width: 260,
      render: (_, row) => (
        <Select
          value={row.target?.key}
          placeholder="— select plan / budget —"
          allowClear
          showSearch
          disabled={row.isDuplicate}
          optionFilterProp="label"
          style={{ width: '100%' }}
          options={rankTargets(targets, row.csvRow.executedon).map((t) => ({
            value: t.key,
            label: t.completed ? `${t.label} (completed)` : t.label,
          }))}
          onChange={(val?: string) => {
            // A planned transaction from another plan/budget no longer applies
            const keep = val !== undefined && row.matched && targetKey(row.matched.planId, row.matched.budgetId) === val
            updateRow(row.key, { target: targets.find((t) => t.key === val), matched: keep ? row.matched : undefined })
          }}
        />
      ),
    },
    {
      title: 'Planned Transaction',
      width: 280,
      render: (_, row) => {
        if (row.isDuplicate) {
          const c = row.matched
          if (!c) return <Text type="secondary">Already imported (linked transaction not found in loaded plans)</Text>
          return (
            <div>
              <div>{c.executedOn ? `${fmtDate(c.executedOn)} · ${c.name}${fmtAmount(c.amount)}` : `${fmtDate(c.plannedDate)} · ${c.name}${fmtAmount(c.plannedAmount)}`}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>{c.planLabel} › {c.budgetName}</Text>
            </div>
          )
        }
        // Only the selected plan / budget; all of them when none is selected
        const own = rankCandidates(
          row.csvRow,
          candidates.filter((c) => !row.target || targetKey(c.planId, c.budgetId) === row.target.key),
          state.accountId,
        )
        const option = ({ candidate: c }: { candidate: Candidate }) => {
          const fixed = matchedAccounts(c, row.csvRow.amount).fixed
          return {
            value: c.id,
            label: `${c.executedOn ? `${fmtDate(c.executedOn)} · executed · ${c.name}${fmtAmount(c.amount)}` : `${fmtDate(c.plannedDate)} · ${c.name}${fmtAmount(c.plannedAmount)}`}${row.target ? '' : ` · ${c.planLabel} › ${c.budgetName}`}${fixed ? ` · account ${fixed.name} will be corrected` : ''}`,
          }
        }
        const options: SelectProps['options'] = TIER_LABELS.map((label, tier) => ({
          label,
          options: own.filter((r) => r.tier === tier).map(option),
        })).filter((g) => g.options.length > 0)
        return (
          <Select
            value={row.matched?.id}
            placeholder={candidates.length === 0 ? 'No planned transactions' : own.length === 0 ? 'None in selected plan / budget' : '— create new —'}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            options={options}
            onChange={(val?: string) => {
              const matched = candidates.find((c) => c.id === val)
              const target = matched ? targets.find((t) => t.key === targetKey(matched.planId, matched.budgetId)) : row.target
              updateRow(row.key, { matched, target })
            }}
          />
        )
      },
    },
    {
      title: 'Partner Acct',
      width: 180,
      render: (_, row) => {
        const nameOf = (id: string | null) => allAccounts.find((a) => a.id === id)?.name ?? '—'
        if (row.details) return <Text type="secondary">{nameOf(row.details.fromAccountId)} → {nameOf(row.details.toAccountId)}</Text>
        if (row.matched) return <Text type="secondary">{(row.matched.to?.type === 'PAYMENT_PARTNER' ? row.matched.to : row.matched.from)?.name ?? '—'}</Text>
        if (row.isDuplicate) return <Text type="secondary">—</Text>
        return (
          <Select
            value={row.partner?.id}
            placeholder="— none —"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            options={partners.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(val?: string) => updateRow(row.key, { partner: partners.find((p) => p.id === val) })}
          />
        )
      },
    },
    {
      title: 'Tags',
      width: 200,
      render: (_, row) => row.isDuplicate ? <Text type="secondary">—</Text> : (
        <TagsField
          tags={tags}
          value={row.tags.map((t) => t.id)}
          onChange={(ids) => updateRow(row.key, { tags: tags.filter((t) => ids.includes(t.id)), tagsTouched: true })}
        />
      ),
    },
    {
      title: 'Details',
      width: 90,
      fixed: 'right',
      render: (_, row) => (
        <Tooltip title="Fill in full transaction details">
          <Button
            size="small"
            type={row.details ? 'primary' : 'default'}
            icon={<EditOutlined />}
            disabled={row.isDuplicate}
            onClick={() => setDetailsKey(row.key)}
          />
        </Tooltip>
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
  const newCount = rows.filter((r) => !r.matched && !r.isDuplicate).length

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {duplicateCount > 0 && (
        <Space size="middle">
          <Text type="warning">
            <WarningOutlined /> {duplicateCount} row(s) were already imported and are excluded.
          </Text>
          <Checkbox checked={hideDuplicates} onChange={(e) => setHideDuplicates(e.target.checked)}>Hide duplicates</Checkbox>
        </Space>
      )}
      {newCount > 0 && (
        <Text type="secondary">
          {newCount} row(s) have no planned transaction and will create new ones (highlighted). Untick a row to discard it.
        </Text>
      )}
      <Table
        dataSource={hideDuplicates ? rows.filter((r) => !r.isDuplicate) : rows}
        columns={columns}
        rowKey="key"
        size="small"
        pagination={{ pageSize: 30 }}
        scroll={{ x: true }}
        rowClassName={(r) => (r.isDuplicate ? 'ant-table-row-disabled' : '')}
        onRow={(r) => ({ style: !r.matched && !r.isDuplicate ? { background: '#fffbe6' } : undefined })}
      />
      <Space>
        <Button onClick={onDiscard}>Discard</Button>
        <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={selectedCount === 0}>
          Submit {selectedCount > 0 ? `(${selectedCount})` : ''} selected
        </Button>
      </Space>
      <TransactionModal
        mode="execute"
        open={detailsKey !== null}
        tx={detailsKey !== null ? modalTxFor(rows.find((r) => r.key === detailsKey)!) : null}
        accounts={allAccounts}
        planIntervalType="ONE_TIME"
        editTags
        initialTagIds={rows.find((r) => r.key === detailsKey)?.tags.map((t) => t.id)}
        resetKey={detailsKey ?? ''}
        title="Transaction details"
        okText="Apply"
        onOk={applyDetails}
        onCancel={() => setDetailsKey(null)}
        onPartnerCreated={(a) => setCreatedPartners((prev) => [...prev, a])}
      />
    </Space>
  )
}

/** Uploads a bank CSV and goes straight to matching it against the plans. */
export default function ReviewPage() {
  const { message } = AntApp.useApp()
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [accountId, setAccountId] = useState<string>()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  // Remounts the review table whenever a new analysis is made
  const [analysisId, setAnalysisId] = useState(0)

  async function handleFile(file: File) {
    try {
      const parsed = await parseCSV(file)
      let selected = accountId
      if (bankAccounts.length === 0) {
        const res = await apiClient.get<BankAccount[]>('/api/accounts')
        const banks = res.data.filter((a) => a.type === 'BANK')
        setBankAccounts(banks)
        selected = (banks.find((a) => a.isDefault) ?? banks[0])?.id
        setAccountId(selected)
      }
      if (!selected) {
        message.warning('No bank account found. Create one first.')
        return false
      }
      setAnalysis(null)
      setCsvRows(parsed)
    } catch {
      message.error('Failed to parse CSV. Check the file format.')
    }
    return false
  }

  useEffect(() => {
    if (csvRows.length === 0 || !accountId) return
    let cancelled = false
    setLoading(true)
    analyzeCsv(csvRows, accountId)
      .then((result) => {
        if (cancelled) return
        setAnalysis(result)
        setAnalysisId((n) => n + 1)
      })
      .catch((err) => { if (!cancelled) message.error(apiError(err, 'Failed to load data')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [csvRows, accountId, message])

  function reset() {
    setCsvRows([])
    setAnalysis(null)
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Upload &amp; Review</Title>

      <Dragger accept=".csv" beforeUpload={handleFile} showUploadList={false} style={{ padding: '24px' }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Click or drag a bank CSV file here</p>
        <p className="ant-upload-hint">Supports your bank's standard CSV export format.</p>
      </Dragger>

      {csvRows.length > 0 && (
        <Space size="middle" wrap>
          <Text type="secondary">{csvRows.length} rows parsed</Text>
          {bankAccounts.length > 0 && (
            <span>
              <Text strong style={{ marginRight: 8 }}>Bank account in this CSV:</Text>
              <Select
                style={{ width: 280 }}
                value={accountId}
                onChange={setAccountId}
                options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </span>
          )}
        </Space>
      )}

      {loading && <Spin />}
      {analysis && !loading && <ReviewTable key={analysisId} state={analysis} onDone={reset} onDiscard={reset} />}
    </Space>
  )
}
