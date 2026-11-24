import { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Tabs, Alert, DatePicker, Divider, Radio, Select, Tag, Typography, Space, App as AntApp, Tooltip, Checkbox, Spin, Upload } from 'antd'
import { WarningOutlined, EditOutlined, InboxOutlined, LeftOutlined, PlusOutlined, RightOutlined, SwapOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { ColumnsType } from 'antd/es/table'
import type { SelectProps } from 'antd'
import axios from 'axios'
import apiClient from '../api/apiClient'
import TransactionModal, { type TxModalBody, type TxModalTx } from '../components/TransactionModal'
import TransactionsTicketCheck from '../components/TransactionsTicketCheck'
import { TagsField } from '../components/TagPicker'
import PartnerTagsModal, { editableLabelRender, partnerLabelRender } from '../components/PartnerTagsModal'
import { parseCSV } from '../features/csv/parseCSV'
import type { CsvRow } from '../features/csv/types'
import { analyzeCsv, loadOtherPlans, type Analysis } from '../features/matching/analyze'
import type { Candidate, MatchResult, Target } from '../features/matching/types'
import { rankCandidates, rankTargets, targetKey, TIER_LABELS } from '../features/matching/rules'
import { apiError, type AccountRef } from '../features/planTransactions'

const { Title, Text } = Typography
const { Dragger } = Upload

dayjs.extend(isoWeek)

// Select value that stands for "no transaction, just store the ticket as processed"
const PROCESSED = '__processed__'

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
  /** Partner account picked in the row; replaces the suggested or matched one */
  partnerOverride?: { id: string | null }
  /** Store the bank ticket as processed without creating or changing a transaction */
  markProcessed?: boolean
  /** Submitted in this session; the row stays as an already imported one */
  submitted?: boolean
  /** Found by the counterpart check; applied when the row is submitted */
  counterpart?: { ticketId: string; accountId: string; account: string; executedOn: string; linked: boolean }
  /** Movement this ticket is the second side of, when its counterpart is already linked to it */
  pairTxId?: string
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('sk-SK') : 'no date')
const fmtAmount = (v: number | null) => (v === null ? '' : ` · ${v.toFixed(2)} €`)

function ReviewTable({ state: initialState, onDone, onDiscard }: { state: Analysis; onDone: () => void; onDiscard: () => void }) {
  const { message } = AntApp.useApp()
  // Reloaded after a planned transaction template was edited
  const [state, setState] = useState(initialState)

  const [rows, setRows] = useState<EditableRow[]>(
    initialState.results.map((r, i) => ({ ...r, key: String(i), selected: false })),
  )
  const [submitting, setSubmitting] = useState(false)
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const [hideDuplicates, setHideDuplicates] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [checkingKey, setCheckingKey] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: 'date' | 'partner'; order: 'ascend' | 'descend' } | null>(null)
  const { pairCandidates, tags } = state
  // Completed plans outside the CSV period, loaded the first time the user searches the plan/budget list
  const [others, setOthers] = useState<{ targets: Target[]; candidates: Candidate[] } | null>(null)
  const loadingOthers = useRef(false)
  const targets = others ? [...state.targets, ...others.targets] : state.targets
  const candidates = others ? [...state.candidates, ...others.candidates] : state.candidates
  function searchTargets() {
    if (others || loadingOthers.current) return
    loadingOthers.current = true
    loadOtherPlans(state.targets, state.accounts)
      .then(setOthers)
      .catch(() => message.error('Failed to load the other plans'))
      .finally(() => { loadingOthers.current = false })
  }
  const [createdPartners, setCreatedPartners] = useState<{ id: string; name: string; type: string }[]>([])
  const [renamedPartners, setRenamedPartners] = useState<Record<string, string>>({})
  const withNewName = <T extends { id: string; name: string }>(a: T): T => (renamedPartners[a.id] ? { ...a, name: renamedPartners[a.id] } : a)
  const partners = [...state.partners, ...createdPartners].map(withNewName)
  const allAccounts = [...state.accounts, ...createdPartners].map(withNewName)
  const [editPartnerId, setEditPartnerId] = useState<string | null>(null)
  // Row that receives the partner account created in the dialog
  const [newPartnerRow, setNewPartnerRow] = useState<string | null>(null)
  // Template (or standalone) transaction behind a matched planned transaction, being edited
  const [plannedEdit, setPlannedEdit] = useState<{ id: string; intervalType: string; tx: TxModalTx } | null>(null)

  const ruleTags = useRef(new Map(initialState.results.map((r, i) => [String(i), r.tags])))
  const appliedSignature = useRef(new Map<string, string>())

  // Matched rows get the tags of the planned transaction (or its template); new ones those of plan, budget and accounts
  useEffect(() => {
    for (const row of rows) {
      if (row.isDuplicate || row.tagsTouched || row.matched?.pairOnly || row.markProcessed) continue
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

  /** Looks for the other side of a movement and prepares the row for it; nothing is saved before the row is submitted. */
  async function checkCounterpart(row: EditableRow) {
    // A second click cancels the preparation
    if (row.counterpart) {
      updateRow(row.key, { counterpart: undefined, pairTxId: undefined, ...(row.counterpart.linked ? { markProcessed: false } : {}) })
      return
    }
    setCheckingKey(row.key)
    try {
      const res = await apiClient.post<{
        status: 'none' | 'counterpartOpen' | 'counterpartLinked' | 'alreadyProcessed'
        counterpart?: { id: string; accountId: string; account: string; executedOn: string }
        pairTransactionId?: string | null
      }>(`/api/bank-tickets/${row.csvRow.ticketDbId}/check-counterpart`)
      const { status, counterpart } = res.data
      const where = counterpart ? `${counterpart.account}, ${counterpart.executedOn}` : ''
      if (status === 'none' || !counterpart) {
        message.info('No counterpart found in your other accounts (opposite amount, within 5 days).')
      } else if (status === 'alreadyProcessed') {
        message.info(`The counterpart (${where}) and this ticket are already processed.`)
      } else if (status === 'counterpartLinked') {
        // The movement is already booked from the other side: this ticket is only stored as processed
        updateRow(row.key, {
          counterpart: { ticketId: counterpart.id, accountId: counterpart.accountId, account: counterpart.account, executedOn: counterpart.executedOn, linked: true },
          markProcessed: true, matched: undefined, pairTxId: res.data.pairTransactionId ?? undefined, selected: true,
        })
        message.success(`The counterpart in ${where} is already linked. This ticket will be marked as processed when you submit.`)
      } else {
        const patch: Partial<EditableRow> = {
          counterpart: { ticketId: counterpart.id, accountId: counterpart.accountId, account: counterpart.account, executedOn: counterpart.executedOn, linked: false },
          selected: true,
        }
        // Unless the planned transaction already is a movement, the booking becomes the movement between the two accounts
        const own = (a: AccountRef | null) => !!a && a.type !== 'PAYMENT_PARTNER'
        const becomesMovement = !row.markProcessed && !(row.matched && own(row.matched.from) && own(row.matched.to))
        if (becomesMovement) {
          const outgoing = row.csvRow.amount < 0
          patch.details = {
            name: row.details?.name ?? null,
            amount: row.details?.amount ?? null,
            fromAccountId: outgoing ? state.accountId : counterpart.accountId,
            toAccountId: outgoing ? counterpart.accountId : state.accountId,
            executedOn: row.details?.executedOn ?? defaultExecutedOn(row),
          }
        }
        updateRow(row.key, patch)
        message.success(`Counterpart found in ${where}. On submit it is marked as processed${becomesMovement ? ' and this row becomes a movement' : ''}.`)
      }
    } catch (err) {
      message.error(apiError(err, 'Failed to check for a counterpart'))
    } finally {
      setCheckingKey(null)
    }
  }

  /** Applies a prepared counterpart: it is paired with the movement booked from this side, or just marked processed. */
  async function settleCounterpart(row: EditableRow, txId: string | null, acc: { from: string | null; to: string | null } | null) {
    const cp = row.counterpart
    if (!cp || cp.linked) return
    const own = (id: string | null) => !!id && allAccounts.some((a) => a.id === id && a.type !== 'PAYMENT_PARTNER')
    const movement = !!txId && !!acc && own(acc.from) && own(acc.to)
    await apiClient.post('/api/bank-tickets', { id: cp.ticketId, accountId: cp.accountId, ...(movement ? { pairedTransactionId: txId } : { processed: true }) })
  }

  async function unmarkProcessed(row: EditableRow) {
    try {
      await apiClient.post(`/api/bank-tickets/${row.ticketDbId}/unpair`)
      updateRow(row.key, { isDuplicate: false, paired: false, submitted: false, ticketDbId: undefined, matched: undefined, target: undefined, selected: true })
    } catch (err) {
      message.error(apiError(err, 'Failed to unmark the bank ticket'))
    }
  }

  /** Rows that use the partner get its changed tags; untouched new rows are recomputed from scratch. */
  function applyPartnerTags(partnerId: string, tagIds: string[]) {
    const wanted = tags.filter((t) => tagIds.includes(t.id))
    setRows((prev) => prev.map((r) => {
      if (r.isDuplicate) return r
      const acc = rowAccounts(r)
      if (acc.from !== partnerId && acc.to !== partnerId) return r
      if (!r.matched && !r.tagsTouched) {
        appliedSignature.current.delete(r.key)
        return { ...r }
      }
      return { ...r, tags: [...r.tags, ...wanted.filter((t) => !r.tags.some((x) => x.id === t.id))] }
    }))
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

  /** From/to account ids the transaction will get: dialog values, else the matched transaction's, else bank account and partner; a partner picked in the row wins. */
  function rowAccounts(row: EditableRow): { from: string | null; to: string | null } {
    if (row.details) return { from: row.details.fromAccountId, to: row.details.toAccountId }
    const override = row.partnerOverride
    const bank = state.accountId
    let base: { from: string | null; to: string | null }
    if (row.matched) {
      base = matchedAccounts(row.matched, row.csvRow.amount)
    } else {
      const partner = override ? override.id : row.partner?.id ?? null
      return row.csvRow.amount < 0 ? { from: bank, to: partner } : { from: partner, to: bank }
    }
    const side = override ? partnerSide(base, row.csvRow.amount) : null
    if (!override || !side) return base
    return side === 'from' ? { from: override.id, to: base.to } : { from: base.from, to: override.id }
  }

  /** The side holding the payment partner (or free to take one); null when an own account sits there. */
  function partnerSide(acc: { from: string | null; to: string | null }, amount: number): 'from' | 'to' | null {
    const isPartner = (id: string | null) => allAccounts.some((a) => a.id === id && a.type === 'PAYMENT_PARTNER')
    if (isPartner(acc.from)) return 'from'
    if (isPartner(acc.to)) return 'to'
    const side = amount < 0 ? 'to' : 'from'
    return acc[side] === null ? side : null
  }

  function setRowPartner(row: EditableRow, id: string | null) {
    const side = partnerSide(rowAccounts(row), row.csvRow.amount)
    if (!side) return
    if (row.details) {
      updateRow(row.key, { details: { ...row.details, [side === 'from' ? 'fromAccountId' : 'toAccountId']: id } })
    } else {
      updateRow(row.key, { partnerOverride: { id } })
    }
  }

  /** Opens the template of the planned transaction (or the transaction itself when it has none) for editing. */
  async function openPlannedEdit(m: Candidate) {
    const id = m.templateId ?? m.id
    try {
      const [txRes, planRes] = await Promise.all([
        apiClient.get<{ name: string | null; plannedAmount: string | null; dueDateConfig: string | null; fromAccountId: string | null; toAccountId: string | null }>(`/api/transactions/${id}`),
        apiClient.get<{ intervalType: string; templateId: string | null }>(`/api/plans/${m.planId}`),
      ])
      // Instances are stored as one-time; the recurrence comes from the plan template
      const intervalType = m.templateId && planRes.data.templateId
        ? (await apiClient.get<{ intervalType: string }>(`/api/plans/${planRes.data.templateId}`)).data.intervalType
        : planRes.data.intervalType
      const t = txRes.data
      const byId = (accId: string | null) => (accId ? allAccounts.find((a) => a.id === accId) ?? null : null)
      setPlannedEdit({
        id,
        intervalType,
        tx: {
          id, name: t.name, plannedAmount: t.plannedAmount, dueDateConfig: t.dueDateConfig,
          fromAccountId: t.fromAccountId, toAccountId: t.toAccountId, fromAccount: byId(t.fromAccountId), toAccount: byId(t.toAccountId),
        },
      })
    } catch (err) {
      message.error(apiError(err, 'Failed to load the planned transaction'))
    }
  }

  async function savePlannedEdit(body: TxModalBody) {
    if (!plannedEdit) return
    try {
      await apiClient.patch(`/api/transactions/${plannedEdit.id}`, {
        name: body.name ?? undefined,
        plannedAmount: body.plannedAmount ?? undefined,
        fromAccountId: body.fromAccountId ?? undefined,
        toAccountId: body.toAccountId ?? undefined,
        dueDateConfig: body.dueDateConfig ?? undefined,
        tagIds: body.tagIds,
      })
      // Loads the changed template values into the candidates, keeping what was edited in the grid
      const fresh = await analyzeCsv(rows.map((r) => r.csvRow), state.accountId)
      const byId = new Map([...fresh.candidates, ...fresh.pairCandidates].map((c) => [c.id, c]))
      setState(fresh)
      setRows((prev) => prev.map((r) => {
        const updated = r.matched && byId.get(r.matched.id)
        if (!updated) return r
        appliedSignature.current.delete(r.key)
        return { ...r, matched: updated }
      }))
      setPlannedEdit(null)
      message.success('Planned transaction updated')
    } catch (err) {
      message.error(apiError(err, 'Failed to update the planned transaction'))
    }
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
    // Row key -> id of the stored bank ticket
    const done = new Map<string, string>()
    for (const row of selected) {
      const csv = row.csvRow
      try {
        if (!row.markProcessed && !row.matched && !row.target) {
          message.warning(`Row ${row.rowIndex + 1}: no plan/budget selected, skipped.`)
          continue
        }

        const ticketRes = await apiClient.post<{ id: string }[]>('/api/bank-tickets', {
          id: csv.ticketDbId,
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
          pairedTransactionId: row.matched?.pairOnly ? row.matched.id : row.pairTxId,
          processed: row.markProcessed || undefined,
        })
        const bankTicketId = ticketRes.data[0].id
        if (row.matched?.pairOnly || row.markProcessed) {
          await settleCounterpart(row, null, null)
          done.set(row.key, bankTicketId)
          continue
        }
        const executedOn = row.details?.executedOn ?? defaultExecutedOn(row)
        const amount = row.details?.amount ?? Math.abs(csv.amount)
        const tagIds = row.tags.map((t) => t.id)
        const acc = rowAccounts(row)
        let txId: string

        if (row.matched) {
          const m = row.matched
          const id = m.id
          txId = id
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
          const created = await apiClient.post<{ id: string }>('/api/transactions', {
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
          txId = created.data.id
        }
        await settleCounterpart(row, txId, acc)
        done.set(row.key, bankTicketId)
      } catch (err) {
        message.error(`Row ${row.rowIndex + 1} failed: ${apiError(err, 'unknown error')}. Continuing with remaining rows.`)
      }
    }

    if (done.size > 0) {
      message.success(`${done.size} transaction(s) submitted successfully.`)
      if (rows.every((r) => r.isDuplicate || done.has(r.key))) {
        onDone()
      } else {
        setRows((prev) => prev.map((r) => (done.has(r.key)
          ? { ...r, isDuplicate: true, submitted: true, selected: false, ticketDbId: done.get(r.key), paired: !!(r.markProcessed || r.matched?.pairOnly) }
          : r)))
      }
    }
    setSubmitting(false)
  }

  const unsortedRows = hideDuplicates ? rows.filter((r) => !r.isDuplicate) : rows
  // Sorted here rather than by the table, so the header checkbox selects the rows of the page that is shown
  const visibleRows = sort
    ? [...unsortedRows].sort((a, b) => {
        const text = (r: EditableRow) => `${r.csvRow.partnername} ${r.csvRow.reference}`
        const order = sort.key === 'date' ? a.csvRow.executedon.localeCompare(b.csvRow.executedon) : text(a).localeCompare(text(b))
        return sort.order === 'ascend' ? order : -order
      })
    : unsortedRows
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visibleRows.length / pageSize)))
  const pageSelectable = visibleRows.slice((currentPage - 1) * pageSize, currentPage * pageSize).filter((r) => !r.isDuplicate)

  const columns: ColumnsType<EditableRow> = [
    {
      title: (
        <Checkbox
          checked={pageSelectable.length > 0 && pageSelectable.every((r) => r.selected)}
          indeterminate={pageSelectable.some((r) => r.selected) && !pageSelectable.every((r) => r.selected)}
          disabled={pageSelectable.length === 0}
          onChange={(e) => {
            const keys = new Set(pageSelectable.map((r) => r.key))
            setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, selected: e.target.checked } : r)))
          }}
        />
      ),
      width: 36,
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
      width: 84,
      render: (_, row) => {
        if (row.submitted) return <Tag color="green" style={{ marginInlineEnd: 0 }}>Submitted</Tag>
        if (row.isDuplicate && row.paired) return <Tag style={{ marginInlineEnd: 0 }}>Processed</Tag>
        if (row.markProcessed) return <Tag style={{ marginInlineEnd: 0 }}>Processed</Tag>
        if (row.isDuplicate) return <Tag color="red" style={{ marginInlineEnd: 0 }}>Duplicate</Tag>
        if (row.matched?.pairOnly) {
          return (
            <Tooltip title="Other side of a movement between your accounts. The ticket is stored as processed and the transaction stays unchanged.">
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>Paired</Tag>
            </Tooltip>
          )
        }
        if (row.matched) return <Tag color="green" style={{ marginInlineEnd: 0 }}>Matched</Tag>
        return (
          <Tooltip title="A new transaction will be created if you tick the row.">
            <Tag color="orange" style={{ marginInlineEnd: 0 }}>New</Tag>
          </Tooltip>
        )
      },
    },
    { title: 'Date', key: 'date', dataIndex: ['csvRow', 'executedon'], width: 92, sorter: true, sortOrder: sort?.key === 'date' ? sort.order : null },
    {
      title: 'Partner / Ref',
      key: 'partner',
      sorter: true,
      sortOrder: sort?.key === 'partner' ? sort.order : null,
      render: (_, row) => (
        <div style={{ overflowWrap: 'anywhere' }}>
          <div>{row.csvRow.partnername}</div>
          {row.csvRow.reference && (
            <Text type="secondary" style={{ fontSize: 11 }}>{row.csvRow.reference}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Amount',
      width: 84,
      render: (_, row) => (
        <span style={{ color: row.csvRow.amount < 0 ? '#cf1322' : '#389e0d', fontWeight: 600 }}>
          {row.csvRow.amount.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Plan / Budget',
      width: '27%',
      render: (_, row) => (
        <Select
          value={row.target?.key}
          placeholder="— select plan / budget —"
          allowClear
          showSearch={{ onSearch: searchTargets }}
          disabled={row.isDuplicate}
          optionFilterProp="label"
          style={{ width: '100%' }}
          popupMatchSelectWidth={380}
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
      width: '18%',
      render: (_, row) => {
        if (row.isDuplicate) {
          const c = row.matched
          const unmark = row.paired && (
            <div><Button type="link" size="small" style={{ padding: 0 }} onClick={() => void unmarkProcessed(row)}>Unmark as processed</Button></div>
          )
          if (!c) {
            return (
              <div>
                <Text type="secondary">{row.submitted ? 'Submitted' : row.paired ? 'Marked as processed' : 'Already imported (linked transaction not found in loaded plans)'}</Text>
                {unmark}
              </div>
            )
          }
          return (
            <div>
              <div>{c.executedOn ? `${fmtDate(c.executedOn)} · ${c.name}${fmtAmount(c.amount)}` : `${fmtDate(c.plannedDate)} · ${c.name}${fmtAmount(c.plannedAmount)}`}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>{c.planLabel} › {c.budgetName}</Text>
              {unmark}
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
        const rowTime = new Date(row.csvRow.executedon).getTime()
        const pairs = pairCandidates
          .filter((c) => (row.csvRow.amount < 0 ? c.from?.id === state.accountId : c.to?.id === state.accountId))
          .sort((a, b) => Math.abs(a.executedOn!.getTime() - rowTime) - Math.abs(b.executedOn!.getTime() - rowTime))
        if (pairs.length > 0) {
          options.push({
            label: 'Other side of a movement (already has a bank ticket)',
            options: pairs.map((c) => ({ value: c.id, label: `${fmtDate(c.executedOn)} · movement · ${c.name}${fmtAmount(c.amount)} · ${c.planLabel} › ${c.budgetName}` })),
          })
        }
        // Only offered when a movement between own accounts with the same amount already exists for this bank account
        const isOwn = (a: AccountRef | null) => !!a && a.type !== 'PAYMENT_PARTNER'
        const hasMovement = [...candidates, ...pairCandidates].some((c) =>
          isOwn(c.from) && isOwn(c.to) &&
          (row.csvRow.amount < 0 ? c.from?.id === state.accountId : c.to?.id === state.accountId) &&
          Math.abs(((c.executedOn ? c.amount : c.plannedAmount) ?? 0) - Math.abs(row.csvRow.amount)) < 0.005)
        if (hasMovement || row.markProcessed) {
          options.push({
            label: 'Other',
            options: [{ value: PROCESSED, label: 'Mark bank ticket as processed (no transaction)' }],
          })
        }
        return (
          <Select
            value={row.markProcessed ? PROCESSED : row.matched?.id}
            placeholder={candidates.length === 0 ? 'No planned transactions' : own.length === 0 ? 'None in selected plan / budget' : '— create new —'}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            popupMatchSelectWidth={520}
            options={options}
            labelRender={(option) => {
              const m = row.matched
              if (row.markProcessed || !m || m.pairOnly || option.value !== m.id) return option.label
              return editableLabelRender('Click to edit the planned transaction template', () => void openPlannedEdit(m))(option)
            }}
            onChange={(val?: string) => {
              if (val === PROCESSED) {
                updateRow(row.key, { markProcessed: true, matched: undefined })
                return
              }
              let matched = candidates.find((c) => c.id === val) ?? pairCandidates.find((c) => c.id === val)
              // Clearing a wrong match falls back to the movement the row looks like the other side of
              if (!matched && row.pairSuggestion && row.matched?.id !== row.pairSuggestion.id && !row.markProcessed) matched = row.pairSuggestion
              const target = matched ? targets.find((t) => t.key === targetKey(matched.planId, matched.budgetId)) : row.target
              updateRow(row.key, { matched, target, markProcessed: false, counterpart: row.counterpart?.linked ? undefined : row.counterpart, pairTxId: undefined })
            }}
          />
        )
      },
    },
    {
      title: 'Partner Acct',
      width: '11%',
      render: (_, row) => {
        if (row.isDuplicate || row.markProcessed) return <Text type="secondary">—</Text>
        const acc = rowAccounts(row)
        const side = partnerSide(acc, row.csvRow.amount)
        if (!side) {
          const nameOf = (id: string | null) => allAccounts.find((a) => a.id === id)?.name ?? '—'
          return <Text type="secondary">{nameOf(acc.from)} → {nameOf(acc.to)}</Text>
        }
        return (
          <Select
            value={acc[side] ?? undefined}
            placeholder="— none —"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            popupMatchSelectWidth={280}
            options={partners.map((p) => ({ value: p.id, label: p.name }))}
            labelRender={partnerLabelRender(setEditPartnerId)}
            popupRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: '4px 0' }} />
                <Button type="link" icon={<PlusOutlined />} onClick={() => setNewPartnerRow(row.key)}>New partner account</Button>
              </>
            )}
            onChange={(val?: string) => setRowPartner(row, val ?? null)}
          />
        )
      },
    },
    {
      title: 'Tags',
      render: (_, row) => row.isDuplicate || row.markProcessed || row.matched?.pairOnly ? <Text type="secondary">—</Text> : (
        <TagsField
          removable
          tags={tags}
          value={row.tags.map((t) => t.id)}
          onChange={(ids) => updateRow(row.key, { tags: tags.filter((t) => ids.includes(t.id)), tagsTouched: true })}
        />
      ),
    },
    {
      title: 'Details',
      width: 88,
      render: (_, row) => (
        <Space size={4}>
          <Tooltip title="Fill in full transaction details">
            <Button
              size="small"
              type={row.details ? 'primary' : 'default'}
              icon={<EditOutlined />}
              disabled={row.isDuplicate || row.markProcessed || row.matched?.pairOnly}
              onClick={() => setDetailsKey(row.key)}
            />
          </Tooltip>
          <Tooltip title={row.counterpart ? `Prepared with the counterpart in ${row.counterpart.account} (${row.counterpart.executedOn}); applied on submit. Click to cancel.` : 'Look for the other side of a movement in your other accounts (opposite amount, within 5 days)'}>
            <Button
              size="small"
              type={row.counterpart ? 'primary' : 'default'}
              icon={<SwapOutlined />}
              loading={checkingKey === row.key}
              disabled={row.isDuplicate || !row.csvRow.ticketDbId}
              onClick={() => void checkCounterpart(row)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  const selectedCount = rows.filter((r) => r.selected && !r.isDuplicate).length
  const duplicateCount = rows.filter((r) => r.isDuplicate).length
  const newCount = rows.filter((r) => !r.matched && !r.isDuplicate && !r.markProcessed).length

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
          {newCount} row(s) have no planned transaction and will create new ones when ticked (highlighted).
        </Text>
      )}
      <Table
        dataSource={visibleRows}
        columns={columns}
        rowKey="key"
        size="small"
        pagination={{ pageSize, current: currentPage, onChange: (p, size) => { setPage(p); setPageSize(size) } }}
        onChange={(_p, _f, s) => {
          const one = Array.isArray(s) ? s[0] : s
          setSort(one?.order && (one.columnKey === 'date' || one.columnKey === 'partner') ? { key: one.columnKey, order: one.order } : null)
        }}
        tableLayout="fixed"
        rowClassName={(r) => (r.isDuplicate ? 'ant-table-row-disabled' : '')}
        onRow={(r) => ({ style: !r.matched && !r.isDuplicate && !r.markProcessed ? { background: '#fffbe6' } : undefined })}
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
        onPartnerRenamed={(id, name) => setRenamedPartners((prev) => ({ ...prev, [id]: name }))}
      />
      <TransactionModal
        open={plannedEdit !== null}
        tx={plannedEdit?.tx ?? null}
        accounts={allAccounts}
        planIntervalType={plannedEdit?.intervalType ?? 'ONE_TIME'}
        editTags
        resetKey={plannedEdit?.id ?? ''}
        title="Edit planned transaction"
        okText="Save"
        onOk={savePlannedEdit}
        onCancel={() => setPlannedEdit(null)}
        onPartnerCreated={(a) => setCreatedPartners((prev) => [...prev, a])}
        onPartnerRenamed={(id, name) => setRenamedPartners((prev) => ({ ...prev, [id]: name }))}
      />
      <PartnerTagsModal
        partner={partners.find((p) => p.id === editPartnerId) ?? null}
        existingNames={partners.map((p) => p.name)}
        onClose={() => setEditPartnerId(null)}
        onSaved={(id, tagIds, name) => {
          setRenamedPartners((prev) => ({ ...prev, [id]: name }))
          if (tagIds) applyPartnerTags(id, tagIds)
        }}
      />
      <PartnerTagsModal
        creating={newPartnerRow !== null}
        existingNames={partners.map((p) => p.name)}
        onClose={() => setNewPartnerRow(null)}
        onCreated={(a) => {
          setCreatedPartners((prev) => [...prev, a])
          const row = rows.find((r) => r.key === newPartnerRow)
          if (row) setRowPartner(row, a.id)
        }}
      />
    </Space>
  )
}

type StoredTicket = {
  id: string
  ticketId: string | null
  amount: string
  executedOn: string
  partnerName: string | null
  partnerAccountNumber: string | null
  reference: string | null
  variableSymbol: string | null
  constantSymbol: string | null
  specificSymbol: string | null
}

type ImportResult = { created: number; existing: number; moved: number; conflicts: string[]; total: number }

const toCsvRow = (t: StoredTicket): CsvRow => ({
  executedon: t.executedOn.slice(0, 10),
  amount: Number(t.amount),
  partnername: t.partnerName ?? '',
  partneraccountnumber: t.partnerAccountNumber ?? '',
  reference: t.reference ?? '',
  variablesymbol: t.variableSymbol ?? '',
  constantsymbol: t.constantSymbol ?? '',
  specificsymbol: t.specificSymbol ?? '',
  ticketid: t.ticketId ?? '',
  ticketDbId: t.id,
})

type PeriodMode = 'week' | 'month' | 'year' | 'custom' | 'all'

const UNIT = { week: 'isoWeek', month: 'month', year: 'year' } as const

/** Week, month and year step with the arrows or a picker; custom takes a range; all means no date limit. */
function PeriodFilter({ mode, offset, range, onMode, onOffset, onRange }: {
  mode: PeriodMode
  offset: number
  range: [Dayjs, Dayjs] | null
  onMode: (m: PeriodMode) => void
  onOffset: (o: number) => void
  onRange: (r: [Dayjs, Dayjs] | null) => void
}) {
  return (
    <Space wrap>
      <Radio.Group value={mode} onChange={(e) => onMode(e.target.value as PeriodMode)} optionType="button" buttonStyle="solid">
        <Radio.Button value="week">Week</Radio.Button>
        <Radio.Button value="month">Month</Radio.Button>
        <Radio.Button value="year">Year</Radio.Button>
        <Radio.Button value="custom">Custom</Radio.Button>
        <Radio.Button value="all">All</Radio.Button>
      </Radio.Group>
      {mode === 'custom' && (
        <DatePicker.RangePicker value={range} onChange={(v) => onRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} format="D MMM YYYY" />
      )}
      {(mode === 'week' || mode === 'month' || mode === 'year') && range && (
        <Space>
          <Button icon={<LeftOutlined />} onClick={() => onOffset(offset - 1)} />
          <DatePicker
            picker={mode}
            value={range[0]}
            allowClear={false}
            format={mode === 'week' ? (d) => `Week ${d.isoWeek()}, ${d.isoWeekYear()}` : mode === 'month' ? 'MMMM YYYY' : 'YYYY'}
            onChange={(d) => { if (d) onOffset(d.startOf(UNIT[mode]).diff(dayjs().startOf(UNIT[mode]), mode)) }}
            style={{ width: 180 }}
            variant="borderless"
          />
          <Button icon={<RightOutlined />} onClick={() => onOffset(offset + 1)} />
        </Space>
      )}
    </Space>
  )
}

/** Stores a bank file once, then links the stored tickets of a chosen date range to plans. */
export default function ReviewPage() {
  const { message } = AntApp.useApp()
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [accountId, setAccountId] = useState<string>()
  const [tab, setTab] = useState('link')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [mode, setMode] = useState<PeriodMode>('custom')
  const [offset, setOffset] = useState(0)
  // Once the user picks a period it stays when the account changes
  const rangeChosen = useRef(false)
  const range = useMemo<[Dayjs, Dayjs] | null>(() => {
    if (mode === 'all') return null
    if (mode === 'custom') return customRange
    const start = dayjs().add(offset, mode).startOf(UNIT[mode])
    return [start, start.endOf(UNIT[mode])]
  }, [mode, offset, customRange])
  // Sets a custom range without counting as the user's choice (from the stored tickets or an import)
  function setRange(r: [Dayjs, Dayjs]) { setMode('custom'); setCustomRange(r) }
  const periodFilter = (
    <PeriodFilter
      mode={mode} offset={offset} range={range}
      onMode={(m) => { rangeChosen.current = true; setMode(m); setOffset(0) }}
      onOffset={(o) => { rangeChosen.current = true; setOffset(o) }}
      onRange={(r) => { rangeChosen.current = true; setCustomRange(r) }}
    />
  )
  const [unlinked, setUnlinked] = useState<{ count: number; from: string; to: string } | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  // Remounts the review table whenever a new analysis is made
  const [analysisId, setAnalysisId] = useState(0)

  useEffect(() => {
    apiClient.get<BankAccount[]>('/api/accounts')
      .then((res) => {
        const banks = res.data.filter((a) => a.type === 'BANK')
        setBankAccounts(banks)
        setAccountId((banks.find((a) => a.isDefault) ?? banks[0])?.id)
      })
      .catch(() => message.error('Failed to load bank accounts'))
  }, [message])

  async function fetchUnlinked(account: string, from?: string, to?: string) {
    const res = await apiClient.get<StoredTicket[]>('/api/bank-tickets', { params: { accountId: account, unlinked: 'true', from, to } })
    return res.data
  }

  async function refreshUnlinked(account: string) {
    try {
      const tickets = await fetchUnlinked(account)
      const dates = tickets.map((t) => t.executedOn.slice(0, 10)).sort()
      setUnlinked(tickets.length > 0 ? { count: tickets.length, from: dates[0], to: dates[dates.length - 1] } : { count: 0, from: '', to: '' })
      return dates
    } catch {
      setUnlinked(null)
      return []
    }
  }

  useEffect(() => {
    setAnalysis(null)
    setImportResult(null)
    if (!accountId) return
    void refreshUnlinked(accountId).then((dates) => {
      if (dates.length > 0 && !rangeChosen.current) setRange([dayjs(dates[0]), dayjs(dates[dates.length - 1])])
    })
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(file: File) {
    if (!accountId) {
      message.warning('Select the bank account this file belongs to first.')
      return false
    }
    setImporting(true)
    try {
      const parsed = (await parseCSV(file)).filter((r) => r.executedon)
      const rows = parsed.map((r) => ({
        ticketId: r.ticketid || undefined,
        name: `${r.partnername} ${r.executedon}`.trim(),
        amount: r.amount,
        executedOn: r.executedon,
        partnerName: r.partnername,
        partnerAccountNumber: r.partneraccountnumber,
        reference: r.reference,
        variableSymbol: r.variablesymbol,
        constantSymbol: r.constantsymbol,
        specificSymbol: r.specificsymbol,
      }))
      const res = await apiClient.post<Omit<ImportResult, 'total'>>('/api/bank-tickets/import', { accountId, rows })
      setImportResult({ ...res.data, total: rows.length })
      setAnalysis(null)
      const dates = rows.map((r) => r.executedOn).sort()
      if (dates.length > 0) setRange([dayjs(dates[0]), dayjs(dates[dates.length - 1])])
      await refreshUnlinked(accountId)
    } catch (err) {
      message.error(apiError(err, 'Failed to import the file. Check the file format.'))
    } finally {
      setImporting(false)
    }
    return false
  }

  async function loadTickets() {
    if (!accountId || (!range && mode !== 'all')) return
    setLoading(true)
    try {
      const tickets = await fetchUnlinked(accountId, range?.[0].format('YYYY-MM-DD'), range?.[1].format('YYYY-MM-DD'))
      if (tickets.length === 0) {
        setAnalysis(null)
        message.info('No unlinked tickets in this date range.')
        return
      }
      setAnalysis(await analyzeCsv(tickets.map(toCsvRow), accountId))
      setAnalysisId((n) => n + 1)
    } catch (err) {
      message.error(apiError(err, 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }

  // Back to the date selection; what is still unlinked is counted again
  function reset() {
    setAnalysis(null)
    if (accountId) void refreshUnlinked(accountId)
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Upload &amp; Review</Title>

      <Space size="middle" wrap>
        <Text strong>Bank account:</Text>
        <Select
          style={{ width: 280 }}
          value={accountId}
          onChange={setAccountId}
          placeholder="Select the bank account"
          options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Space>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'link',
            label: 'Link tickets to plans',
            children: (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                <Space wrap>
                  {periodFilter}
                  <Button type="primary" onClick={loadTickets} loading={loading} disabled={!accountId || (!range && mode !== 'all')}>Load tickets</Button>
                  <Text type="secondary">
                    {unlinked === null || !accountId
                      ? 'Select a bank account.'
                      : unlinked.count === 0
                        ? 'No unlinked tickets stored for this account.'
                        : `${unlinked.count} unlinked ticket(s) stored, from ${unlinked.from} to ${unlinked.to}.`}
                  </Text>
                </Space>
                {loading && <Spin />}
                {analysis && !loading && <ReviewTable key={analysisId} state={analysis} onDone={reset} onDiscard={reset} />}
              </Space>
            ),
          },
          {
            key: 'noTicket',
            label: 'Transactions without ticket',
            children: (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                {periodFilter}
                <TransactionsTicketCheck accountId={accountId} range={range} check="noTicket" />
              </Space>
            ),
          },
          {
            key: 'dateMismatch',
            label: 'Date differs from ticket',
            children: (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                {periodFilter}
                <TransactionsTicketCheck accountId={accountId} range={range} check="dateMismatch" />
              </Space>
            ),
          },
          {
            key: 'import',
            label: 'Import a bank file',
            children: (
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Dragger accept=".csv" beforeUpload={handleFile} showUploadList={false} disabled={importing || !accountId} style={{ padding: '16px' }}>
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">Click or drag the bank CSV of the selected account here</p>
                  <p className="ant-upload-hint">
                    The tickets are stored once. Importing a file again does not duplicate them; if a ticket was stored for another account, it moves to the selected one.
                  </p>
                </Dragger>
                {importing && <Spin />}
                {importResult && (
                  <Alert
                    type={importResult.moved > 0 || importResult.conflicts.length > 0 ? 'warning' : 'success'}
                    showIcon
                    title={`${importResult.total} rows read: ${importResult.created} new, ${importResult.existing} already stored`}
                    description={
                      (importResult.moved > 0 ? `${importResult.moved} ticket(s) were stored for another account and were moved to the selected one, together with the account of their transactions. ` : '')
                      + (importResult.conflicts.length > 0 ? `${importResult.conflicts.length} could not be stored: ${importResult.conflicts.slice(0, 5).join(', ')}${importResult.conflicts.length > 5 ? '…' : ''}` : '')
                      || undefined
                    }
                  />
                )}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  )
}
