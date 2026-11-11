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
