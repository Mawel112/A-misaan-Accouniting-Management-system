export function formatCurrency(amount: number | null | undefined, symbol = '$'): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '—';
  }
  const num = Number(amount);
  const absFormatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `-${symbol}${absFormatted}` : `${symbol}${absFormatted}`;
}

export function formatUsd(amount: number | null | undefined): string {
  return formatCurrency(amount, '$');
}

export function formatShilling(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '—';
  }
  const num = Number(amount);
  const absFormatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `-SH. ${absFormatted}` : `SH. ${absFormatted}`;
}

export function convertShToUsd(shAmount: number, exchangeRate: number): number {
  const safeRate = exchangeRate > 0 ? exchangeRate : 8500;
  return Number((shAmount / safeRate).toFixed(2));
}

export function formatDisplayDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const clean = isoDate.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
