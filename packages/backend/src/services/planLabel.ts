const RECURRING = new Set(['WEEKLY', 'MONTHLY', 'YEARLY'])

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Period suffix for recurring plan instances: "Month YYYY", "Week NN.YYYY" or "YYYY". startDate is a UTC-midnight @db.Date. */
export function periodSuffix(intervalType: string, startDate: Date): string | null {
  if (intervalType === 'YEARLY') return String(startDate.getUTCFullYear())
  if (intervalType === 'MONTHLY') return MONTH_YEAR.format(startDate)
  if (intervalType === 'WEEKLY') {
    // ISO week: the week belongs to the year containing its Thursday
    const thursday = new Date(startDate)
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
    const isoYear = thursday.getUTCFullYear()
    const week = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / 86400000 + 1) / 7)
    return `Week ${String(week).padStart(2, '0')}.${isoYear}`
  }
  return null
}

export function isRecurringInterval(intervalType: string): boolean {
  return RECURRING.has(intervalType)
}

/** Returns the name with the period suffix appended, unchanged if it already has it. */
export function withPeriodSuffix(name: string, intervalType: string, startDate: Date): string {
  const suffix = periodSuffix(intervalType, startDate)
  if (!suffix || name.endsWith(suffix)) return name
  return `${name} - ${suffix}`
}
