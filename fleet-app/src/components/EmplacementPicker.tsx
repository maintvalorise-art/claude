import { ETAGES, RACKS, formatEmplacement, parseEmplacement, useCasesParEtage } from '../lib/stock';
import { Select } from './ui';

/** Choix de l'emplacement dans le magasin : rack, étage, case. */
export default function EmplacementPicker({ value, onChange, required, compact }: { value: string; onChange: (v: string) => void; required?: boolean; compact?: boolean }) {
  const cases = useCasesParEtage();
  const e = parseEmplacement(value);
  const ancien = value && !e ? value : null;
  const set = (rack: string, etage: number, c: number) => onChange(rack ? formatEmplacement({ rack, etage: etage || 1, case: c || 1 }) : '');

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Select aria-label="Rack" value={e?.rack ?? ''} required={required} onChange={(x) => set(x.target.value, e?.etage ?? 1, e?.case ?? 1)}>
          <option value="">Rack</option>
          {RACKS.map((r) => <option key={r} value={r}>{compact ? r : `Rack ${r}`}</option>)}
        </Select>
        <Select aria-label="Étage" value={e?.etage ?? ''} disabled={!e} onChange={(x) => set(e!.rack, Number(x.target.value), e!.case)}>
          {Array.from({ length: ETAGES }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{compact ? n : `Étage ${n}${n === 1 ? ' (bas)' : n === ETAGES ? ' (haut)' : ''}`}</option>)}
        </Select>
        <Select aria-label="Case" value={e?.case ?? ''} disabled={!e} onChange={(x) => set(e!.rack, e!.etage, Number(x.target.value))}>
          {Array.from({ length: Math.max(cases, e?.case ?? 0) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{compact ? n : `Case ${n}`}</option>)}
        </Select>
      </div>
      {ancien && <p className="mt-1 text-xs text-amber-700">Ancien emplacement : « {ancien} ». Choisissez le rack, l'étage et la case.</p>}
    </div>
  );
}
