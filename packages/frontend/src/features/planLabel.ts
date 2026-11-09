/** Period suffix for recurring plan instances: "Month YYYY", "Week NN.YYYY" or "YYYY". */
export function periodSuffix(intervalType: string, startDate: string): string | null {
  const [y, m, d] = startDate.slice(0, 10).split('-').map(Number)
  if (intervalType === 'YEARLY') return String(y)
  if (intervalType === 'MONTHLY') {
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  if (intervalType === 'WEEKLY') {
    // ISO week: the week belongs to the year containing its Thursday
    const thursday = new Date(Date.UTC(y, m - 1, d))
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
    const isoYear = thursday.getUTCFullYear()
    const week = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / 86400000 + 1) / 7)
    return `Week ${String(week).padStart(2, '0')}.${isoYear}`
  }
  return null
}

/** Display name of a plan; completed plans already store the suffix in their name, so it isn't added twice. */
export function planLabel(plan: { name: string | null; isTemplate: boolean; intervalType: string; templateIntervalType?: string | null; startDate: string | null }): string {
  const base = plan.name ?? '(unnamed)'
  if (plan.isTemplate || !plan.startDate) return base
  // Instances are stored as ONE_TIME; the recurrence comes from their template
  const suffix = periodSuffix(plan.templateIntervalType ?? plan.intervalType, plan.startDate)
  if (!suffix || base.endsWith(suffix)) return base
  return `${base} - ${suffix}`
}
