/** Compute the planned date for a transaction from its dueDateConfig and the plan's startDate */
export function computePlannedOn(dueDateConfig: string | null | undefined, planStartDate: string | null | undefined): Date | null {
  if (!dueDateConfig || !planStartDate) return null
  let cfg: {
    month?: number; day?: number; week?: number; weekDay?: number;
    date?: string; backwards?: boolean
  }
  try { cfg = JSON.parse(dueDateConfig) } catch { return null }
  if (!cfg) return null

  if (cfg.date) {
    const cfgDate = new Date(cfg.date);
    return !isNaN(cfgDate.getTime()) ? cfgDate : null;
  } 

  // Start from plan start date
  const d = new Date(planStartDate)
  if (isNaN(d.getTime())) return null

  if (cfg.month) {
    d.setMonth(d.getMonth() + cfg.month)
  }

  if (cfg.day !== undefined) {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    let day = cfg.day
    if (day > daysInMonth) day = daysInMonth
    if (!cfg.backwards) {
      d.setDate(d.getDate() + day - 1)
    } else {
      // Go to start of next month, subtract day days
      d.setMonth(d.getMonth() + 1, 1)
      d.setDate(d.getDate() - day)
    }
  } else if (cfg.weekDay !== undefined) {
    // weekDay is a bitmask power-of-2: Monday=1, Tuesday=2, Wednesday=4 ...
    const targetDow = Math.round(Math.log2(cfg.weekDay)) // 0=Mon ... 6=Sun
    if (cfg.backwards) {
      // Nth occurrence of weekDay counting from the end of the month
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const lastDow = (new Date(d.getFullYear(), d.getMonth(), daysInMonth).getDay() + 6) % 7
      let offset = targetDow <= lastDow ? lastDow - targetDow : 7 - (targetDow - lastDow)
      if (cfg.week && cfg.week > 1) offset += 7 * (cfg.week - 1)
      d.setDate(daysInMonth - offset)
    } else {
      const firstDow = (d.getDay() + 6) % 7
      let offset = targetDow >= firstDow ? targetDow - firstDow : 7 - (firstDow - targetDow)
      if (cfg.week && cfg.week > 1) {
        offset += 7 * (cfg.week - 1)
        const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
        if (d.getDate() + offset >= daysInMonth) offset -= 7
      }
      d.setDate(d.getDate() + offset)
    }
  }
  return d;
}