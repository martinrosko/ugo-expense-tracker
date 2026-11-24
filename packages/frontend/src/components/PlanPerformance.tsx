import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Popover, Tag, Tooltip, Typography } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import type { BudgetStats } from '../features/planStats'

const { Text } = Typography

const GREEN = { dark: '#389e0d', light: '#95de64' }
const RED = { dark: '#cf1322', light: '#ff7875' }

// Below this container width the component switches to its compact layout
const FULL_MIN_WIDTH = 480

const money = (v: number) =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const signedMoney = (v: number) => `${v < 0 ? '-' : '+'}${money(v)}`

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

type Side = { label: string; symbol: string; planned: number; actual: number; reserved: number; higherIsBetter: boolean }

/** One 6px bar for the mini view: actual dark, reserved light, planned tick; green when ahead of plan, red when behind. */
function MiniBar({ side }: { side: Side }) {
  const { planned, actual, reserved, higherIsBetter } = side
  const projected = actual + reserved
  const good = (higherIsBetter ? projected - planned : planned - projected) >= 0
  const colors = good ? GREEN : RED
  const max = Math.max(planned, projected)
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0)
  const empty = planned === 0 && actual === 0 && reserved === 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 8, fontSize: 9, lineHeight: 1, color: higherIsBetter ? GREEN.dark : RED.dark }}>{side.symbol}</span>
      <div style={{ position: 'relative', flex: 1, height: 6, background: '#f0f0f0', borderRadius: 3 }}>
        {!empty && (
          <>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(actual)}%`, background: colors.dark, borderRadius: '3px 0 0 3px' }} />
            <div style={{ position: 'absolute', left: `${pct(actual)}%`, top: 0, bottom: 0, width: `${pct(reserved)}%`, background: colors.light }} />
            {planned > 0 && <div style={{ position: 'absolute', left: `calc(${pct(planned)}% - 1px)`, top: -2, bottom: -2, width: 2, background: '#262626' }} />}
          </>
        )}
      </div>
    </div>
  )
}

function Bar({ side, compact }: { side: Side; compact: boolean }) {
  const { planned, actual, reserved, higherIsBetter } = side
  const projected = actual + reserved
  // Positive means better than planned: more income, or less spent
  const delta = higherIsBetter ? projected - planned : planned - projected
  const good = delta >= 0
  const colors = good ? GREEN : RED
  const max = Math.max(planned, projected)
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0)
  const verdict = higherIsBetter ? (good ? 'above plan' : 'below plan') : (good ? 'under plan' : 'over plan')

  if (planned === 0 && actual === 0 && reserved === 0) {
    return compact
      ? <Text type="secondary" style={{ fontSize: 11 }} title={`${side.label}: nothing planned`}>{side.symbol} —</Text>
      : <Text type="secondary" style={{ fontSize: 12 }}>{side.label}: nothing planned</Text>
  }

  const tip: ReactNode = (
    <div>
      <div>{side.label}</div>
      <div>Planned: {money(planned)}</div>
      <div>Actual: {money(actual)}</div>
      <div>Reserved: {money(reserved)}</div>
      <div>Projected: {money(projected)}</div>
      <div>Delta: {signedMoney(delta)} ({verdict})</div>
    </div>
  )

  const track = (
    <Tooltip title={tip}>
      <div style={{ position: 'relative', flex: 1, minWidth: 40, height: compact ? 8 : 14, background: '#f0f0f0', borderRadius: 3, margin: compact ? 0 : '4px 0' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(actual)}%`, background: colors.dark, borderRadius: '3px 0 0 3px' }} />
        <div style={{ position: 'absolute', left: `${pct(actual)}%`, top: 0, bottom: 0, width: `${pct(reserved)}%`, background: colors.light }} />
        {/* Income that will fall short of the plan */}
        {!good && higherIsBetter && (
          <div
            style={{
              position: 'absolute', left: `${pct(projected)}%`, top: 0, bottom: 0, width: `${pct(planned) - pct(projected)}%`,
              background: `repeating-linear-gradient(45deg, ${RED.light}55, ${RED.light}55 3px, transparent 3px, transparent 6px)`,
            }}
          />
        )}
        {planned > 0 && (
          <div style={{ position: 'absolute', left: `calc(${pct(planned)}% - 1px)`, top: -2, bottom: -2, width: 2, background: '#262626' }} />
        )}
      </div>
    </Tooltip>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 12, width: 12, flexShrink: 0, color: higherIsBetter ? GREEN.dark : RED.dark }} title={side.label}>{side.symbol}</Text>
        {track}
        <Text style={{ fontSize: 11, flexShrink: 0, color: colors.dark, whiteSpace: 'nowrap' }} title={verdict}>{signedMoney(delta)}</Text>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Text strong style={{ fontSize: 12 }}>{side.label}</Text>
        <Tag color={good ? 'success' : 'error'} style={{ marginInlineEnd: 0 }}>{signedMoney(delta)} {verdict}</Tag>
      </div>
      <div style={{ display: 'flex' }}>{track}</div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        planned {money(planned)} · actual {money(actual)} · reserved {money(reserved)} · projected {money(projected)}
      </Text>
    </div>
  )
}

/**
 * Execution of a plan or budget instance: actual, reserved and projected against the planned amount, for income and expenses.
 * Fills its container; below 480px wide (or with size="compact") it collapses to slim one-line bars.
 * size="mini" is a fixed 100x40px indicator whose details open in a popover on hover or click.
 */
export default function PlanPerformance({ stats, title, size = 'auto' }: { stats: BudgetStats; title?: string; size?: 'auto' | 'full' | 'compact' | 'mini' }) {
  const [ref, width] = useWidth()
  // Until measured, start compact so a narrow container never flashes the large layout
  const compact = size === 'compact' || (size === 'auto' && width < FULL_MIN_WIDTH)

  const netPlanned = stats.incPlanned - stats.expPlanned
  const netProjected = stats.incActual + stats.incReserved - (stats.expActual + stats.expReserved)
  const netDelta = netProjected - netPlanned
  const hasData = stats.incPlanned + stats.incActual + stats.incReserved + stats.expPlanned + stats.expActual + stats.expReserved > 0

  if (size === 'mini') {
    if (!hasData) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
    return (
      <Popover
        trigger={['hover', 'click']}
        placement="bottomRight"
        content={<div style={{ width: 440, maxWidth: '80vw' }}><PlanPerformance stats={stats} title={title} size="full" /></div>}
      >
        {/* Stops the click from also toggling a collapse panel this sits in */}
        <div onClick={(e) => e.stopPropagation()} style={{ width: 100, maxHeight: 50, flexShrink: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MiniBar side={{ label: 'Income', symbol: '↑', planned: stats.incPlanned, actual: stats.incActual, reserved: stats.incReserved, higherIsBetter: true }} />
          <MiniBar side={{ label: 'Expenses', symbol: '↓', planned: stats.expPlanned, actual: stats.expActual, reserved: stats.expReserved, higherIsBetter: false }} />
          <Text style={{ fontSize: 10, lineHeight: 1.2, textAlign: 'right', whiteSpace: 'nowrap', color: netDelta >= 0 ? GREEN.dark : RED.dark }}>
            {netProjected < 0 && <WarningOutlined />} {signedMoney(netDelta)}
          </Text>
        </div>
      </Popover>
    )
  }

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 12, width: '100%', minWidth: 0 }}>
      {title && <Text strong>{title}</Text>}
      <Bar side={{ label: 'Income', symbol: '↑', planned: stats.incPlanned, actual: stats.incActual, reserved: stats.incReserved, higherIsBetter: true }} compact={compact} />
      <Bar side={{ label: 'Expenses', symbol: '↓', planned: stats.expPlanned, actual: stats.expActual, reserved: stats.expReserved, higherIsBetter: false }} compact={compact} />
      {hasData && (compact ? (
        <Tooltip title={`Net: planned ${signedMoney(netPlanned)}, projected ${signedMoney(netProjected)}`}>
          <Text style={{ fontSize: 11, color: netDelta >= 0 ? GREEN.dark : RED.dark }}>
            Net {signedMoney(netProjected)} ({signedMoney(netDelta)} vs plan){netProjected < 0 && <> <WarningOutlined title="below zero" /></>}
          </Text>
        </Tooltip>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Text strong style={{ fontSize: 12 }}>Net</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>planned {signedMoney(netPlanned)} → projected {signedMoney(netProjected)}</Text>
          <Tag color={netDelta >= 0 ? 'success' : 'error'} style={{ marginInlineEnd: 0 }}>{signedMoney(netDelta)}</Tag>
          {netProjected < 0 && <Tag color="error" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>below zero</Tag>}
        </div>
      ))}
    </div>
  )
}
