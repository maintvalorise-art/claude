import { useState } from 'react';
import { Button, Card, ErrorBox, Input, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { fetchControlItems } from '../../lib/data';
import { errorMessage, supabase } from '../../lib/supabase';
import type { ControlItem } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

/** Paramétrage des points de la fiche de contrôle (admin). */
export default function Settings() {
  const { data, loading, error, reload } = useAsync(() => fetchControlItems(true));
  const [draft, setDraft] = useState({ categorie: '', label_fr: '', label_ar: '' });
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(p: PromiseLike<{ error: unknown }>) {
    setActionError(null);
    const { error: err } = await p;
    if (err) setActionError(errorMessage(err));
    else void reload();
  }

  function update(it: ControlItem, patch: Partial<ControlItem>) {
    void run(supabase.from('control_items').update(patch).eq('id', it.id));
  }

  function add() {
    if (!draft.label_fr.trim() || !draft.categorie.trim()) return setActionError('Catégorie et libellé obligatoires.');
    const ordre = Math.max(0, ...(data ?? []).map((i) => i.ordre)) + 10;
    void run(
      supabase.from('control_items').insert({
        categorie: draft.categorie.trim(), label_fr: draft.label_fr.trim(), label_ar: draft.label_ar.trim() || null, ordre,
      }),
    ).then(() => setDraft({ categorie: draft.categorie, label_fr: '', label_ar: '' }));
  }

  const categories = [...new Set((data ?? []).map((i) => i.categorie))];

  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Points de la fiche de contrôle avant départ" />
      <ErrorBox>{actionError}</ErrorBox>
      <Card title="Ajouter un point de contrôle" className="mb-5">
        <div className="grid gap-2 sm:grid-cols-4">
          <Input list="cats" placeholder="Catégorie" value={draft.categorie} onChange={(e) => setDraft({ ...draft, categorie: e.target.value })} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Input placeholder="Libellé (français)" value={draft.label_fr} onChange={(e) => setDraft({ ...draft, label_fr: e.target.value })} />
          <Input placeholder="التسمية (عربية)" dir="rtl" value={draft.label_ar} onChange={(e) => setDraft({ ...draft, label_ar: e.target.value })} />
          <Button onClick={add}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Points de contrôle">
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table head={['Ordre', 'Catégorie', 'Libellé', 'Arabe', 'Actif']}>
            {data!.map((it) => (
              <tr key={it.id} className={it.actif ? '' : 'opacity-50'}>
                <Td><Input type="number" className="w-20" defaultValue={it.ordre} onBlur={(e) => Number(e.target.value) !== it.ordre && update(it, { ordre: Number(e.target.value) })} /></Td>
                <Td><Input defaultValue={it.categorie} onBlur={(e) => e.target.value.trim() && e.target.value !== it.categorie && update(it, { categorie: e.target.value.trim() })} /></Td>
                <Td><Input defaultValue={it.label_fr} onBlur={(e) => e.target.value.trim() && e.target.value !== it.label_fr && update(it, { label_fr: e.target.value.trim() })} /></Td>
                <Td><Input dir="rtl" defaultValue={it.label_ar ?? ''} onBlur={(e) => e.target.value !== (it.label_ar ?? '') && update(it, { label_ar: e.target.value.trim() || null })} /></Td>
                <Td><input type="checkbox" className="h-4 w-4" checked={it.actif} onChange={(e) => update(it, { actif: e.target.checked })} /></Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">Un point désactivé n'apparaît plus dans les nouvelles fiches mais reste visible dans l'historique.</p>
      </Card>
    </div>
  );
}
