import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

export type RecurringInterval = 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export const UNIT = { WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const
export const MAX_YEARS_AHEAD = 50

export function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** "Week 6, 2023" / "February 2023" / "2023" for a period start date (YYYY-MM-DD). */
export function formatPeriod(interval: RecurringInterval, start: string | null): string {
  if (!start) return '—'
  const d = dayjs(start)
  if (interval === 'WEEKLY') return `Week ${d.isoWeek()}, ${d.isoWeekYear()}`
  if (interval === 'MONTHLY') return d.format('MMMM YYYY')
  return d.format('YYYY')
}

export const pickerFor = (interval: RecurringInterval) => (interval === 'WEEKLY' ? 'week' : interval === 'MONTHLY' ? 'month' : 'year') as 'week' | 'month' | 'year'

export function pickerFormat(interval: RecurringInterval): string | ((d: Dayjs) => string) {
  if (interval === 'WEEKLY') return (d) => `Week ${d.isoWeek()}, ${d.isoWeekYear()}`
  return interval === 'MONTHLY' ? 'MMMM YYYY' : 'YYYY'
}

/** Disables periods before the one containing `from` and anything more than 50 years ahead of it. */
export function disabledOutsideRange(interval: RecurringInterval, from: Dayjs) {
  const unit = interval === 'WEEKLY' ? 'isoWeek' : interval === 'MONTHLY' ? 'month' : 'year'
  return (d: Dayjs) => d.isBefore(from.startOf(unit), 'day') || d.isAfter(from.add(MAX_YEARS_AHEAD, 'year'), 'day')
}

export type PeriodMode = 'month' | 'quarter' | 'year' | 'custom' | 'all'

export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getPeriod(mode: Exclude<PeriodMode, 'all' | 'custom'>, offset: number): { from: Date; to: Date; label: string } {
  const now = new Date()
  if (mode === 'month') {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from: base, to, label: base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  if (mode === 'quarter') {
    const currentQ = Math.floor(now.getMonth() / 3)
    const qMonth = (currentQ + offset) * 3
    const base = new Date(now.getFullYear(), qMonth, 1)
    const y = base.getFullYear(); const m = base.getMonth()
    return { from: new Date(y, m, 1), to: new Date(y, m + 3, 0, 23, 59, 59, 999), label: `Q${Math.floor(m / 3) + 1} ${y}` }
  }
  const year = now.getFullYear() + offset
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999), label: String(year) }
}

export function computeOffset(mode: Exclude<PeriodMode, 'all' | 'custom'>, picked: Dayjs): number {
  const now = new Date()
  if (mode === 'month') return (picked.year() - now.getFullYear()) * 12 + (picked.month() - now.getMonth())
  if (mode === 'quarter') {
    const currentQ = Math.floor(now.getMonth() / 3)
    const pickedQ = Math.floor(picked.month() / 3)
    return (picked.year() - now.getFullYear()) * 4 + (pickedQ - currentQ)
  }
  return picked.year() - now.getFullYear()
}
