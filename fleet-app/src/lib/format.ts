export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return date.toLocaleDateString('fr-FR');
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtNumber(n: number | string | null | undefined, digits = 0) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits || 2, minimumFractionDigits: digits });
}

export function fmtMoney(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
}

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysAgoIso(n: number) {
  const d = new Date(Date.now() - n * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Nombre de jours depuis une date. */
export function daysSince(d: string | null | undefined) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
}
