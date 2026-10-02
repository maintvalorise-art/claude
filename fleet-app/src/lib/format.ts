import type { Echeance } from './types';

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return date.toLocaleDateString('fr-FR');
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('fr-FR');
}

export function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
}

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Texte du délai restant d'une échéance (« dans 12 j », « expiré depuis 3 j », « 800 km restants »). */
export function delaiEcheance(e: Echeance, unite = 'km') {
  if (e.source === 'vidange') {
    const r = e.reste_compteur ?? 0;
    return r <= 0 ? `Dépassée de ${fmtNumber(-r)} ${unite}` : `${fmtNumber(r)} ${unite} restants`;
  }
  const j = e.jours_restants ?? 0;
  if (j < 0) return `Expiré depuis ${-j} j`;
  if (j === 0) return "Expire aujourd'hui";
  return `Dans ${j} j`;
}
