import { useState } from 'react';
import { Button, Card, ErrorBox, Input, PageHeader, Spinner, SuccessBox, Table, Td } from '../../components/ui';
import { fetchControlItems } from '../../lib/data';
import { errorMessage, supabase } from '../../lib/supabase';
import type { ControlItem, Module, Parametre } from '../../lib/types';
import { moduleOn } from '../../lib/config';
import { must, useAsync } from '../../lib/useAsync';

const PARAM_MODULE: Record<string, Module> = {
  seuil_validation_direction: 'achats',
  seuil_trois_devis: 'achats',
  contrat_alerte_jours: 'achats',
  benne_immobile_jours: 'bennes',
};

export default function Settings() {
  const items = useAsync(() => fetchControlItems(true));
  const params = useAsync(async () => (must(await supabase.from('parametres').select('*').order('cle')) as Parametre[])
    .filter((p) => moduleOn(PARAM_MODULE[p.cle] ?? 'flotte')));
  const [draft, setDraft] = useState({ categorie: '', label_fr: '', label_ar: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(p: PromiseLike<{ error: unknown }>, reload: () => void, ok?: string) {
    setError(null);
    setMsg(null);
    const { error: err } = await p;
    if (err) setError(errorMessage(err));
    else {
      if (ok) setMsg(ok);
      reload();
    }
  }

  const update = (it: ControlItem, patch: Partial<ControlItem>) => run(supabase.from('control_items').update(patch).eq('id', it.id), items.reload);

  function add() {
    if (!draft.label_fr.trim() || !draft.categorie.trim()) return setError('Catégorie et libellé obligatoires.');
    const ordre = Math.max(0, ...(items.data ?? []).map((i) => i.ordre)) + 10;
    void run(supabase.from('control_items').insert({ categorie: draft.categorie.trim(), label_fr: draft.label_fr.trim(), label_ar: draft.label_ar.trim() || null, ordre }), items.reload)
      .then(() => setDraft({ categorie: draft.categorie, label_fr: '', label_ar: '' }));
  }

  const categories = [...new Set((items.data ?? []).map((i) => i.categorie))];

  return (
    <div className="space-y-5">
      <PageHeader title="Paramètres" subtitle="Seuils d'alerte et points de la fiche de contrôle" />
      <SuccessBox>{msg}</SuccessBox>
      <ErrorBox>{error}</ErrorBox>
      <Card title="Seuils et alertes">
        {params.loading || !params.data ? <Spinner /> : (
          <Table head={['Paramètre', 'Valeur']}>
            {params.data.map((p) => (
              <tr key={p.cle}>
                <Td>{p.libelle}</Td>
                <Td>
                  <Input type="number" min={0} step="any" className="w-36" defaultValue={p.valeur}
                    onBlur={(e) => Number(e.target.value) !== Number(p.valeur) && run(supabase.from('parametres').update({ valeur: Number(e.target.value) }).eq('cle', p.cle), params.reload, 'Paramètre enregistré.')} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Ajouter un point à la fiche de contrôle">
        <div className="grid gap-2 sm:grid-cols-4">
          <Input list="cats" placeholder="Catégorie" value={draft.categorie} onChange={(e) => setDraft({ ...draft, categorie: e.target.value })} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Input placeholder="Libellé (français)" value={draft.label_fr} onChange={(e) => setDraft({ ...draft, label_fr: e.target.value })} />
          <Input placeholder="التسمية (عربية)" dir="rtl" value={draft.label_ar} onChange={(e) => setDraft({ ...draft, label_ar: e.target.value })} />
          <Button onClick={add}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Points de la fiche de contrôle">
        {items.loading || !items.data ? <Spinner /> : (
          <Table head={['Ordre', 'Catégorie', 'Libellé', 'Arabe', 'Actif']}>
            {items.data.map((it) => (
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
        <p className="mt-3 text-xs text-slate-500">Un point désactivé n'apparaît plus dans les nouvelles fiches mais reste dans l'historique.</p>
      </Card>
    </div>
  );
}
