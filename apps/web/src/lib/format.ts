/** Format integer cents as a currency string: 10025 → "$100.25" */
export function formatCents(cents: number, symbol = '$'): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const remainder = Math.abs(cents) % 100;
  const sign = cents < 0 ? '-' : '';
  return `${sign}${symbol}${dollars}.${String(remainder).padStart(2, '0')}`;
}

/** Format integer minor units as currency: 10000 → "$100.00" */
export function formatMoney(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/** Format token count: 10000 → "10,000 tokens" */
export function formatTokens(amount: number): string {
  return `${new Intl.NumberFormat('en-US').format(amount)} tokens`;
}

/** Format cents as big blind units for table display */
export function formatBB(cents: number, bbCents: number): string {
  if (bbCents === 0) return formatCents(cents);
  const bbs = cents / bbCents;
  return `${bbs % 1 === 0 ? bbs.toFixed(0) : bbs.toFixed(1)}bb`;
}
