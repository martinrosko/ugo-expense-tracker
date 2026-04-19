import { useState } from 'react'
import { Button, Card, Typography, Space, Spin, Alert, Tag, message } from 'antd'
import { ApiOutlined, ImportOutlined } from '@ant-design/icons'
import axios from 'axios'
import rescoClient from '../api/rescoClient'
import apiClient from '../api/apiClient'
import type { RwAccount, RwBudget, RwPlan, RwTransaction } from '../types/resco'
import { AccountType, PlanIntervalType, TransactionType } from '../types/resco'

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data
    if (typeof data === 'string') return data
    if (typeof data?.message === 'string') return data.message
    if (typeof data?.error === 'string') return data.error
    return `HTTP ${err.response?.status ?? '?'}: ${err.message}`
  }
  return err instanceof Error ? err.message : 'Unknown error'
}

const { Title, Text } = Typography

const PAGE_SIZE = 1000

async function fetchAllResco<T>(entity: string, params: Record<string, string>): Promise<T[]> {
  const results: T[] = []
  let skip = 0
  while (true) {
    const res = await rescoClient.get<{ value: T[] }>(`/${entity}`, {
      params: { ...params, $top: PAGE_SIZE, $skip: skip },
    })
    const page = res.data.value
    results.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return results
}

const ENTITIES = [
  { name: 'rw_account', label: 'Accounts' },
  { name: 'rw_bankticket', label: 'Bank Tickets' },
  { name: 'rw_budget', label: 'Budgets' },
  { name: 'rw_plan', label: 'Plans' },
  { name: 'rw_transaction', label: 'Transactions' },
  { name: 'rw_tag', label: 'Tags' },
  { name: 'rw_transactiontag', label: 'Transaction Tags' },
]

type EntityState = {
  loading: boolean
  data: unknown[] | null
  error: string | null
}

const initialState: Record<string, EntityState> = Object.fromEntries(
  ENTITIES.map((e) => [e.name, { loading: false, data: null, error: null }]),
)

export default function RescoTestPage() {
  const [states, setStates] = useState<Record<string, EntityState>>(initialState)
  // Per-entity import state: { importing, result }
  const [importStates, setImportStates] = useState<Record<string, { importing: boolean; result: string | null }>>({})
  const [messageApi, contextHolder] = message.useMessage()

  function setEntityState(name: string, patch: Partial<EntityState>) {
    setStates((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  function setImport(entity: string, importing: boolean, result: string | null = null) {
    setImportStates((prev) => ({ ...prev, [entity]: { importing, result } }))
  }

  async function loadEntity(entityName: string) {
    setEntityState(entityName, { loading: true, data: null, error: null })
    try {
      const res = await rescoClient.get<{ value: unknown[] }>(`/${entityName}`, {
        params: { $top: 5 },
      })
      setEntityState(entityName, { loading: false, data: res.data.value })
    } catch (err: unknown) {
      const msg = extractError(err)
      setEntityState(entityName, { loading: false, error: msg })
    }
  }

  async function importAccounts() {
    setImport('rw_account', true)
    try {
      const rescoAccounts = await fetchAllResco<RwAccount>('rw_account', {
        $select: 'id,name,rw_accounttype,rw_isdefault,rw_initialbalance',
        $filter: 'statecode eq 0',
      })

      const typeMap: Record<number, string> = {
        [AccountType.Cash]: 'CASH',
        [AccountType.Bank]: 'BANK',
        [AccountType.Investment]: 'INVESTMENT',
        [AccountType.PaymentPartner]: 'PAYMENT_PARTNER',
      }

      const existingRes = await apiClient.get<{ id: string; name: string }[]>('/api/accounts')
      const existingIds = new Set(existingRes.data.map((a) => a.id))

      const toImport = rescoAccounts.filter((a) => !existingIds.has(a.id))
      await Promise.all(
        toImport.map((a) =>
          apiClient.post('/api/accounts', {
            id: a.id,
            name: a.name,
            type: typeMap[a.rw_accounttype] ?? 'PAYMENT_PARTNER',
            initialBalance: a.rw_initialbalance ?? 0,
            isDefault: a.rw_isdefault ?? false,
          }),
        ),
      )

      const msg = `Imported ${toImport.length} account(s). ${rescoAccounts.length - toImport.length} already existed.`
      setImport('rw_account', false, msg)
      messageApi.success(msg)
    } catch (err: unknown) {
      const msg = extractError(err)
      setImport('rw_account', false, `Error: ${msg}`)
      messageApi.error(msg)
    }
  }

  async function importPlans() {
    setImport('rw_plan', true)
    try {
      // 1. Fetch all Resco plans
      const rescoPlans = await fetchAllResco<RwPlan>('rw_plan', {
        $select: 'id,name,rw_startdate,rw_enddate,rw_intervaltype,rw_istemplate,rw_recurrenceconfig,__rw_defaultaccountid_id,__rw_templateid_id,statecode,statuscode',
      })

      // 2. Build Resco accountId → account name map (to resolve default account)
      const rescoAccounts = await fetchAllResco<RwAccount>('rw_account', {
        $select: 'id,name',
        $filter: 'statecode eq 0',
      })
      const rescoIdToName = new Map(rescoAccounts.map((a) => [a.id, a.name]))

      // 3. Build backend account name â†’ backend id map
      const backendAccountsRes = await apiClient.get<{ id: string; name: string }[]>('/api/accounts')
      const nameToBackendId = new Map(backendAccountsRes.data.map((a) => [a.name, a.id]))

      // 4. Get existing plans from backend to skip duplicates (dedup by id since we reuse Resco IDs)
      const existingRes = await apiClient.get<{ id: string; name: string }[]>('/api/plans')
      const existingIds = new Set(existingRes.data.map((p) => p.id))

      const intervalMap: Record<number, string> = {
        [PlanIntervalType.OneTime]: 'ONE_TIME',
        [PlanIntervalType.Weekly]: 'WEEKLY',
        [PlanIntervalType.Monthly]: 'MONTHLY',
        [PlanIntervalType.Yearly]: 'YEARLY',
      }

      // Sort: templates first so templateId FK references are satisfied
      const toImport = rescoPlans
        .filter((p) => !existingIds.has(p.id))
        .sort((a, b) => (a.rw_istemplate ? 0 : 1) - (b.rw_istemplate ? 0 : 1))

      // Pre-compute which IDs will actually be inserted so we can nullify
      // templateId references that point to a plan not being imported
      const willBeImported = new Set([...toImport.map((p) => p.id), ...existingIds])

      for (const p of toImport) {
        const resolvedTemplateId = p.__rw_templateid_id && willBeImported.has(p.__rw_templateid_id)
          ? p.__rw_templateid_id
          : null
        await apiClient.post('/api/plans', {
          id: p.id,
          name: p.name,
          startDate: p.rw_startdate?.slice(0, 10) ?? null,
          endDate: p.rw_enddate ?? null, // Resco endDate is exclusive midnight local time — UTC shift gives correct inclusive date
          intervalType: intervalMap[p.rw_intervaltype ?? PlanIntervalType.OneTime] ?? 'ONE_TIME',
          isTemplate: p.rw_istemplate ?? false,
          templateId: resolvedTemplateId,
          defaultAccountId: p.__rw_defaultaccountid_id
            ? (nameToBackendId.get(rescoIdToName.get(p.__rw_defaultaccountid_id) ?? '') ?? null)
            : null,
          recurrenceConfig: p.rw_recurrenceconfig ?? null,
          stateCode: p.statecode ?? 0,
          statusCode: p.statuscode ?? 0,
        })
      }

      const msg = `Imported ${toImport.length} plan(s). ${existingRes.data.length} already existed.`
      setImport('rw_plan', false, msg)
      messageApi.success(msg)
    } catch (err: unknown) {
      const msg = extractError(err)
      setImport('rw_plan', false, `Error: ${msg}`)
      messageApi.error(msg)
    }
  }

  async function importBudgets() {
    setImport('rw_budget', true)
    try {
      // 1. Fetch all Resco budgets
      const rescoBudgets = await fetchAllResco<RwBudget>('rw_budget', {
        $select: 'id,name,rw_amount,__rw_defaultaccountid_id,__rw_templateid_id,__rw_parentid_id,statecode,statuscode',
      })

      // 2. Get existing budgets from backend to skip duplicates (dedup by id)
      const existingRes = await apiClient.get<{ id: string }[]>('/api/budgets')
      const existingIds = new Set(existingRes.data.map((b) => b.id))

      // 3. Get all plan IDs in backend â€” budgets whose plan wasn't imported must be skipped
      const plansRes = await apiClient.get<{ id: string }[]>('/api/plans')
      const backendPlanIds = new Set(plansRes.data.map((p) => p.id))

      const toImport = rescoBudgets.filter((b) => !existingIds.has(b.id))

      // Sort: template budgets (no templateId) first so FK references are satisfied
      toImport.sort((a, b) => (a.__rw_templateid_id ? 1 : 0) - (b.__rw_templateid_id ? 1 : 0))

      // Pre-compute which IDs will be inserted (for templateId resolution)
      const willBeImported = new Set([...toImport.map((b) => b.id), ...existingIds])

      let skippedNoPlan = 0

      for (const b of toImport) {
        // Skip if the parent plan doesn't exist in our DB
        if (!b.__rw_parentid_id || !backendPlanIds.has(b.__rw_parentid_id)) {
          skippedNoPlan++
          continue
        }

        const resolvedTemplateId = b.__rw_templateid_id && willBeImported.has(b.__rw_templateid_id)
          ? b.__rw_templateid_id
          : null

        await apiClient.post('/api/budgets', {
          id: b.id,
          name: b.name,
          amount: b.rw_amount ?? null,
          planId: b.__rw_parentid_id,
          // Since accounts were imported with Resco IDs, the Resco accountId IS the backend accountId
          defaultAccountId: b.__rw_defaultaccountid_id ?? null,
          templateId: resolvedTemplateId,
          stateCode: b.statecode ?? 0,
          statusCode: b.statuscode ?? 0,
        })
      }

      const imported = toImport.length - skippedNoPlan
      const msg = `Imported ${imported} budget(s). ${existingRes.data.length} already existed${skippedNoPlan ? `, ${skippedNoPlan} skipped (plan not found)` : ''}.`
      setImport('rw_budget', false, msg)
      messageApi.success(msg)
    } catch (err: unknown) {
      const msg = extractError(err)
      setImport('rw_budget', false, `Error: ${msg}`)
      messageApi.error(msg)
    }
  }

  async function importTransactions() {
    setImport('rw_transaction', true)
    try {
      // 1. Fetch all Resco transactions
      const rescoTxs = await fetchAllResco<RwTransaction>('rw_transaction', {
        $select: 'id,name,rw_amount,rw_plannedamount,rw_plannedon,rw_executedon,rw_duedateconfig,rw_type,__rw_parentid_id,__rw_templateid_id,__rw_bankticketid_id,__rw_fromaccountid_id,__rw_toaccountid_id,statecode,statuscode',
      })

      // 2. Get existing transaction IDs from backend (dedup)
      const existingRes = await apiClient.get<{ id: string }[]>('/api/transactions')
      const existingIds = new Set(existingRes.data.map((t) => t.id))

      // 3. Fetch backend plan, budget and account IDs
      const [plansRes, budgetsRes, accountsRes] = await Promise.all([
        apiClient.get<{ id: string }[]>('/api/plans'),
        apiClient.get<{ id: string }[]>('/api/budgets'),
        apiClient.get<{ id: string }[]>('/api/accounts'),
      ])
      const backendPlanIds = new Set(plansRes.data.map((p) => p.id))
      const backendBudgetIds = new Set(budgetsRes.data.map((b) => b.id))
      const backendAccountIds = new Set(accountsRes.data.map((a) => a.id))

      const toImport = rescoTxs.filter((t) => !existingIds.has(t.id))

      // Sort: transactions that ARE referenced as templates go first
      const referencedAsTemplate = new Set(
        toImport.map((t) => t.__rw_templateid_id).filter(Boolean) as string[],
      )
      toImport.sort((a, b) => {
        const aIsTemplate = referencedAsTemplate.has(a.id) ? 0 : 1
        const bIsTemplate = referencedAsTemplate.has(b.id) ? 0 : 1
        return aIsTemplate - bIsTemplate
      })

      // Pre-compute which IDs will be inserted (for safe templateId resolution)
      const willBeImported = new Set([...toImport.map((t) => t.id), ...existingIds])

      const typeMap: Record<number, string> = {
        [TransactionType.Transaction]: 'TRANSACTION',
        [TransactionType.Balance]: 'BALANCE',
      }

      let skippedNoParent = 0

      for (const t of toImport) {
        // Resolve parentId: check plans first, then budgets
        let planId: string | null = null
        let budgetId: string | null = null
        if (t.__rw_parentid_id) {
          if (backendPlanIds.has(t.__rw_parentid_id)) {
            planId = t.__rw_parentid_id
          } else if (backendBudgetIds.has(t.__rw_parentid_id)) {
            budgetId = t.__rw_parentid_id
          } else {
            skippedNoParent++
            continue
          }
        }

        const resolvedTemplateId = t.__rw_templateid_id && willBeImported.has(t.__rw_templateid_id)
          ? t.__rw_templateid_id
          : null

        await apiClient.post('/api/transactions', {
          id: t.id,
          name: t.name ?? null,
          amount: t.rw_amount ?? null,
          plannedAmount: t.rw_plannedamount ?? null,
          plannedOn: t.rw_plannedon?.slice(0, 10) ?? null,
          executedOn: t.rw_executedon?.slice(0, 10) ?? null,
          dueDateConfig: t.rw_duedateconfig ?? null,
          type: typeMap[t.rw_type ?? TransactionType.Transaction] ?? 'TRANSACTION',
          planId,
          budgetId,
          fromAccountId: t.__rw_fromaccountid_id && backendAccountIds.has(t.__rw_fromaccountid_id) ? t.__rw_fromaccountid_id : null,
          toAccountId: t.__rw_toaccountid_id && backendAccountIds.has(t.__rw_toaccountid_id) ? t.__rw_toaccountid_id : null,
          templateId: resolvedTemplateId,
          stateCode: t.statecode ?? 0,
          statusCode: t.statuscode ?? 0,
        })
      }

      const imported = toImport.length - skippedNoParent
      const msg = `Imported ${imported} transaction(s). ${existingRes.data.length} already existed${skippedNoParent ? `, ${skippedNoParent} skipped (parent not found)` : ''}.`
      setImport('rw_transaction', false, msg)
      messageApi.success(msg)
    } catch (err: unknown) {
      const msg = extractError(err)
      setImport('rw_transaction', false, `Error: ${msg}`)
      messageApi.error(msg)
    }
  }
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {contextHolder}
      <Space>
        <ApiOutlined style={{ fontSize: 24 }} />
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Resco OData â€” Entity Test
          </Title>
          <Text type="secondary">
            org: <Text code>rohelbb</Text> Â· base:{' '}
            <Text code>https://rohelbb.rescocrm.com/odata/v4/</Text>
          </Text>
        </div>
      </Space>

      {ENTITIES.map(({ name, label }) => {
        const state = states[name]
        const recordCount = state.data?.length ?? 0

        return (
          <Card
            key={name}
            title={
              <Space>
                {label}
                {state.data !== null && (
                  <Tag color="blue">{recordCount} record{recordCount !== 1 ? 's' : ''}</Tag>
                )}
              </Space>
            }
            extra={
              <Space>
                <Text type="secondary" code style={{ fontSize: 12 }}>
                  {name}
                </Text>
                {name === 'rw_account' ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<ImportOutlined />}
                    loading={importStates['rw_account']?.importing}
                    onClick={importAccounts}
                  >
                    Import all to Ugo
                  </Button>
                ) : name === 'rw_plan' ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<ImportOutlined />}
                    loading={importStates['rw_plan']?.importing}
                    onClick={importPlans}
                  >
                    Import all to Ugo
                  </Button>
                ) : name === 'rw_budget' ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<ImportOutlined />}
                    loading={importStates['rw_budget']?.importing}
                    onClick={importBudgets}
                  >
                    Import all to Ugo
                  </Button>
                ) : name === 'rw_transaction' ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<ImportOutlined />}
                    loading={importStates['rw_transaction']?.importing}
                    onClick={importTransactions}
                  >
                    Import all to Ugo
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    loading={state.loading}
                    onClick={() => loadEntity(name)}
                  >
                    Load 5
                  </Button>
                )}
              </Space>
            }
          >
            {name === 'rw_account' && importStates['rw_account']?.importing && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching from Resco and saving to Ugoâ€¦" />
              </div>
            )}
            {name === 'rw_account' && !importStates['rw_account']?.importing && importStates['rw_account']?.result && (
              <Alert
                type={importStates['rw_account'].result.startsWith('Error') ? 'error' : 'success'}
                showIcon
                message={importStates['rw_account'].result}
              />
            )}
            {name === 'rw_account' && !importStates['rw_account']?.importing && !importStates['rw_account']?.result && (
              <Text type="secondary">Click "Import all to Ugo" to fetch all accounts from Resco and save them to the database.</Text>
            )}
            {name === 'rw_plan' && importStates['rw_plan']?.importing && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching plans from Resco, resolving accounts, saving to Ugoâ€¦" />
              </div>
            )}
            {name === 'rw_plan' && !importStates['rw_plan']?.importing && importStates['rw_plan']?.result && (
              <Alert
                type={importStates['rw_plan'].result.startsWith('Error') ? 'error' : 'success'}
                showIcon
                message={importStates['rw_plan'].result}
              />
            )}
            {name === 'rw_plan' && !importStates['rw_plan']?.importing && !importStates['rw_plan']?.result && (
              <Text type="secondary">Click "Import all to Ugo" to fetch all plans from Resco. Default accounts are resolved by name.</Text>
            )}
            {name === 'rw_budget' && importStates['rw_budget']?.importing && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching budgets from Resco, saving to Ugoâ€¦" />
              </div>
            )}
            {name === 'rw_budget' && !importStates['rw_budget']?.importing && importStates['rw_budget']?.result && (
              <Alert
                type={importStates['rw_budget'].result.startsWith('Error') ? 'error' : 'success'}
                showIcon
                message={importStates['rw_budget'].result}
              />
            )}
            {name === 'rw_budget' && !importStates['rw_budget']?.importing && !importStates['rw_budget']?.result && (
              <Text type="secondary">Click "Import all to Ugo" to fetch all budgets from Resco. Plans must be imported first.</Text>
            )}
            {name === 'rw_transaction' && importStates['rw_transaction']?.importing && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching transactions from Resco, saving to Ugoâ€¦" />
              </div>
            )}
            {name === 'rw_transaction' && !importStates['rw_transaction']?.importing && importStates['rw_transaction']?.result && (
              <Alert
                type={importStates['rw_transaction'].result.startsWith('Error') ? 'error' : 'success'}
                showIcon
                message={importStates['rw_transaction'].result}
              />
            )}
            {name === 'rw_transaction' && !importStates['rw_transaction']?.importing && !importStates['rw_transaction']?.result && (
              <Text type="secondary">Click "Import all to Ugo" to fetch all transactions from Resco. Plans and budgets must be imported first.</Text>
            )}
            {name !== 'rw_account' && name !== 'rw_plan' && name !== 'rw_budget' && name !== 'rw_transaction' && state.loading && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin tip="Fetching from Rescoâ€¦" />
              </div>
            )}
            {name !== 'rw_account' && name !== 'rw_plan' && name !== 'rw_budget' && name !== 'rw_transaction' && state.error && (
              <Alert type="error" showIcon message="Request failed" description={state.error} />
            )}
            {name !== 'rw_account' && name !== 'rw_plan' && name !== 'rw_budget' && name !== 'rw_transaction' && state.data !== null && !state.loading && (
              state.data.length === 0 ? (
                <Text type="secondary">No records found.</Text>
              ) : (
                <pre
                  style={{
                    background: '#f6f8fa',
                    border: '1px solid #e8e8e8',
                    borderRadius: 4,
                    padding: 12,
                    overflow: 'auto',
                    maxHeight: 320,
                    fontSize: 12,
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {JSON.stringify(state.data, null, 2)}
                </pre>
              )
            )}
            {name !== 'rw_account' && name !== 'rw_plan' && name !== 'rw_budget' && name !== 'rw_transaction' && !state.loading && !state.error && state.data === null && (
              <Text type="secondary">Click "Load 5" to fetch records on demand.</Text>
            )}
          </Card>
        )
      })}
    </Space>
  )
}
