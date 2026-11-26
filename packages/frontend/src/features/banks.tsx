import type { CSSProperties } from 'react'

export type Bank = { code: string; label: string; abbr: string; color: string }

// Monogram badges in approximate brand colours, not the official logos
export const BANKS: Bank[] = [
  { code: 'VUB', label: 'VÚB banka', abbr: 'VÚB', color: '#00549f' },
  { code: 'CSOB', label: 'ČSOB', abbr: 'ČS', color: '#0b3a82' },
  { code: 'TATRABANKA', label: 'Tatra banka', abbr: 'TB', color: '#e30613' },
  { code: 'SLSP', label: 'Slovenská sporiteľňa', abbr: 'SP', color: '#1d6fd1' },
  { code: 'POSTOVA', label: 'Poštová banka', abbr: 'PB', color: '#e8a100' },
  { code: 'PRIMA', label: 'Prima banka', abbr: 'PR', color: '#0097a7' },
  { code: 'OTP', label: 'OTP Banka', abbr: 'OTP', color: '#3a8f3a' },
  { code: 'UNICREDIT', label: 'UniCredit Bank', abbr: 'UC', color: '#d6001c' },
  { code: 'MBANK', label: 'mBank', abbr: 'mB', color: '#d9261c' },
  { code: 'FIO', label: 'Fio banka', abbr: 'FIO', color: '#2c6db5' },
  { code: 'B365', label: '365.bank', abbr: '365', color: '#00a0a0' },
  { code: 'REVOLUT', label: 'Revolut', abbr: 'R', color: '#191c1f' },
  { code: 'OTHER', label: 'Other', abbr: '•••', color: '#8c8c8c' },
]

export const bankByCode = (code: string | null | undefined) => BANKS.find((b) => b.code === code)

export function BankIcon({ bank, size = 20 }: { bank: Bank; size?: number }) {
  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, borderRadius: 4, background: bank.color, color: '#fff',
    fontSize: size * (bank.abbr.length > 2 ? 0.34 : 0.45), fontWeight: 700, lineHeight: 1,
  }
  return <span style={style} aria-hidden>{bank.abbr}</span>
}

export function BankLabel({ bank }: { bank: Bank }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><BankIcon bank={bank} />{bank.label}</span>
}
