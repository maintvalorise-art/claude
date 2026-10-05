import { useMemo, useState, type ReactNode } from 'react';
import { exportCsv } from '../lib/export';
import { Button, Empty, Input, cx } from './ui';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Valeur texte pour la recherche, le tri et l'export. */
  value?: (row: T) => string | number | null | undefined;
  className?: string;
  noExport?: boolean;
}

/** Tableau avec recherche, tri, export Excel et impression (PDF). */
export default function DataTable<T>({
  rows, columns, rowKey, onRowClick, searchPlaceholder = 'Rechercher…', exportName, toolbar, empty = 'Aucun résultat.',
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  exportName?: string;
  toolbar?: ReactNode;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const val = (c: Column<T>, r: T) => {
    if (c.value) return c.value(r);
    const v = (r as Record<string, unknown>)[c.key];
    return typeof v === 'string' || typeof v === 'number' ? v : v == null ? '' : String(v);
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = s ? rows.filter((r) => columns.some((c) => String(val(c, r) ?? '').toLowerCase().includes(s))) : rows;
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c) {
        out = [...out].sort((a, b) => {
          const va = val(c, a) ?? '';
          const vb = val(c, b) ?? '';
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * sort.dir;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, columns]);

  function doExport() {
    const cols = columns.filter((c) => !c.noExport);
    exportCsv(exportName ?? 'export', cols.map((c) => c.label), list.map((r) => cols.map((c) => val(c, r))));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Input className="w-full sm:w-64" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        {toolbar}
        <div className="ml-auto flex gap-2">
          {exportName && <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={doExport}>⬇ Excel</Button>}
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>🖨 PDF</Button>
        </div>
      </div>
      {list.length === 0 ? <Empty>{empty}</Empty> : (
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="cursor-pointer select-none whitespace-nowrap px-4 py-2 font-medium hover:text-slate-800"
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                  >
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx(onRowClick && 'cursor-pointer hover:bg-slate-50', rowClassName?.(r))}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} className={cx('px-4 py-2 align-top', i === 0 && 'whitespace-nowrap', c.className)}>{c.render ? c.render(r) : val(c, r) || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pt-2 text-xs text-slate-400">{list.length} ligne(s)</div>
        </div>
      )}
    </div>
  );
}
