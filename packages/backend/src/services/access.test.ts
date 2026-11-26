import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSeeDetails, maskTransaction, redactTransaction, viewForList, viewForPlan, type TxViewer } from './access.js'

const own = { id: 'a-own', name: 'VUB Osobny', type: 'BANK' }
const foreign = { id: 'a-foreign', name: 'Their Bank', type: 'BANK' }
const partner = { id: 'p1', name: 'Tesco', type: 'PAYMENT_PARTNER' }

const viewer: TxViewer = { userId: 'me', accountIds: new Set([own.id]) }
const OWNER = 'me'

const tx = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: '10', plannedAmount: '12', plannedOn: null, executedOn: '2026-11-01', dueDateConfig: null, type: 'TRANSACTION',
  templateId: null, createdById: null, fromAccount: own, toAccount: partner, ...over,
})

test('details are visible when the viewer co-owns an involved asset account', () => {
  assert.equal(canSeeDetails(tx(), viewer, OWNER), true)
  assert.equal(canSeeDetails(tx({ fromAccount: own, toAccount: foreign }), viewer, OWNER), true)
})

test('details are hidden when every involved asset account is someone else\'s', () => {
  assert.equal(canSeeDetails(tx({ fromAccount: foreign, toAccount: partner }), viewer, OWNER), false)
})

test('without an asset account only the creator, or the plan owner for generated rows, sees details', () => {
  const noAssets = { fromAccount: partner, toAccount: null }
  assert.equal(canSeeDetails(tx({ ...noAssets, createdById: 'other' }), viewer, OWNER), false)
  assert.equal(canSeeDetails(tx({ ...noAssets, createdById: 'me' }), viewer, 'other'), true)
  assert.equal(canSeeDetails(tx({ ...noAssets }), viewer, OWNER), true)
  assert.equal(canSeeDetails(tx({ ...noAssets }), viewer, 'other'), false)
})

test('a visible transaction shows the counterpart asset account without identity', () => {
  const shown = redactTransaction({ ...tx({ toAccount: foreign }), toAccountId: foreign.id }, viewer)
  assert.deepEqual(shown.toAccount, { id: '', name: 'Private account', type: 'BANK' })
  assert.equal(shown.toAccountId, null)
  assert.equal(shown.fromAccount, own)
})

test('a masked row carries only dates, amounts and direction', () => {
  const masked = maskTransaction(tx({ fromAccount: foreign, toAccount: partner, name: 'Secret rent', templateId: 'tpl' }), 'k')
  assert.deepEqual(Object.keys(masked).sort(), [
    'amount', 'bankTicketId', 'dueDateConfig', 'executedOn', 'fromAccount', 'id', 'masked', 'name', 'plannedAmount', 'plannedOn', 'templateId', 'toAccount', 'type',
  ])
  assert.equal(masked.name, 'Private transaction')
  assert.equal(masked.templateId, 'masked')
  assert.deepEqual(masked.fromAccount, { id: '', name: '', type: 'BANK' })
  assert.deepEqual(masked.toAccount, { id: '', name: '', type: 'PAYMENT_PARTNER' })
  assert.ok(!JSON.stringify(masked).includes('Their Bank'))
})

test('plan views keep hidden rows as masked ones and use inherited template values', () => {
  const hidden = tx({
    id: 'secret', fromAccount: null, toAccount: null, plannedAmount: null, dueDateConfig: null, name: null,
    template: { fromAccount: foreign, toAccount: partner, plannedAmount: '99', plannedOn: null, dueDateConfig: '+5d' },
  })
  const [shown, masked] = viewForPlan([tx(), hidden], viewer, OWNER, 'p')
  assert.equal((shown as { id: string }).id, 't1')
  const m = masked as ReturnType<typeof maskTransaction>
  assert.equal(m.masked, true)
  assert.equal(m.id, 'masked:p:1')
  assert.equal(m.plannedAmount, '99')
  assert.equal(m.dueDateConfig, '+5d')
  assert.equal(m.fromAccount?.type, 'BANK')
})

test('plan views flag which rows the viewer may edit', () => {
  const rows = [tx({ id: 'mine', createdById: 'me' }), tx({ id: 'theirs', createdById: 'other' })]
  const editable = (role: 'OWNER' | 'CONTRIBUTOR' | 'VIEWER') =>
    viewForPlan(rows, viewer, 'other', 'p', { role, isTemplate: false }).map((r) => (r as { canEdit: boolean }).canEdit)
  assert.deepEqual(editable('OWNER'), [true, true])
  assert.deepEqual(editable('CONTRIBUTOR'), [true, false])
  assert.deepEqual(editable('VIEWER'), [false, false])
})

test('account lists drop hidden rows instead of masking them', () => {
  const rows = viewForList([tx(), tx({ id: 't2', fromAccount: foreign })], viewer, () => OWNER)
  assert.deepEqual(rows.map((r) => r.id), ['t1'])
})
