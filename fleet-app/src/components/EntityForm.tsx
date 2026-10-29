import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../lib/supabase';
import EmplacementPicker from './EmplacementPicker';
import { Button, ErrorBox, Field, Input, Select, Textarea, cx } from './ui';

export type FieldDef = {
  name: string;
  label: ReactNode;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'textarea' | 'checkbox' | 'tags' | 'email' | 'tel' | 'emplacement';
  options?: [string, string][];
  required?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  step?: string;
  min?: number;
  full?: boolean;
  disabled?: boolean;
  /** Pour type="tags" : liste de choix possibles (cases à cocher). */
  choices?: string[];
};

export type Values = Record<string, unknown>;

function toInput(v: unknown, type: FieldDef['type']): unknown {
  if (type === 'checkbox') return Boolean(v);
  if (type === 'tags') return Array.isArray(v) ? v : [];
  if (v === null || v === undefined) return '';
  if (type === 'datetime' && typeof v === 'string') {
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return String(v);
}

/** Convertit les valeurs saisies (chaînes) vers les types attendus par la base. */
export function normalize(fields: FieldDef[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox' || f.type === 'tags') out[f.name] = v;
    else if (v === '' || v === undefined) out[f.name] = null;
    else if (f.type === 'number') out[f.name] = Number(v);
    else if (f.type === 'datetime') out[f.name] = new Date(String(v)).toISOString();
    else out[f.name] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Formulaire généré à partir d'une liste de champs. */
export default function EntityForm({
  fields, initial, onSubmit, submitLabel = 'Enregistrer', children,
}: {
  fields: FieldDef[];
  initial?: Values | null;
  onSubmit: (values: Values) => Promise<void>;
  submitLabel?: string;
  children?: ReactNode;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(fields.map((f) => [f.name, toInput(initial?.[f.name], f.type)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(normalize(fields, values));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const v = values[f.name];
          const common = { required: f.required, disabled: f.disabled, placeholder: f.placeholder };
          if (f.type === 'checkbox') {
            return (
              <label key={f.name} className={cx('flex items-center gap-2 self-end pb-2 text-sm', f.full && 'sm:col-span-2')}>
                <input type="checkbox" className="h-4 w-4" checked={Boolean(v)} disabled={f.disabled} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            );
          }
          let input: ReactNode;
          if (f.type === 'select') {
            input = (
              <Select {...common} value={String(v)} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">—</option>
                {f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            );
          } else if (f.type === 'emplacement') {
            input = <EmplacementPicker value={String(v)} onChange={(x) => set(f.name, x)} required={f.required} />;
          } else if (f.type === 'textarea') {
            input = <Textarea {...common} value={String(v)} onChange={(e) => set(f.name, e.target.value)} rows={3} />;
          } else if (f.type === 'tags') {
            const list = v as string[];
            input = (
              <div className="flex flex-wrap gap-1.5">
                {f.choices?.map((c) => {
                  const on = list.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set(f.name, on ? list.filter((x) => x !== c) : [...list, c])}
                      className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600')}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            );
          } else {
            const type = f.type === 'datetime' ? 'datetime-local' : f.type ?? 'text';
            input = (
              <Input
                {...common}
                type={type}
                step={f.step ?? (f.type === 'number' ? 'any' : undefined)}
                min={f.min}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={String(v)}
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
          }
          return (
            <Field key={f.name} label={<>{f.label}{f.required && ' *'}</>} hint={f.hint} className={cx((f.full || f.type === 'textarea' || f.type === 'tags') && 'sm:col-span-2')}>
              {input}
            </Field>
          );
        })}
      </div>
      {children}
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Enregistrement…' : submitLabel}</Button>
    </form>
  );
}
