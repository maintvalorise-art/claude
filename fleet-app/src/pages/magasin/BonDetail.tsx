import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, ErrorBox, Spinner } from '../../components/ui';
import { fetchPeople, vehicleLabel } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { MOUVEMENT_MOTIF } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Article, BonStock, MouvementStock, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

/** Bon de réception / livraison au format A5, prêt à imprimer. */
export default function BonDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, loading, error } = useAsync(async () => {
    const bon = must(await supabase.from('bons_stock').select('*').eq('id', id!).single()) as BonStock;
    const lignes = must(await supabase.from('mouvements_stock').select('*').eq('bon_id', id!).order('created_at')) as MouvementStock[];
    const ids = [...new Set(lignes.map((l) => l.article_id))];
    const [articles, vehicle, people] = await Promise.all([
      ids.length ? supabase.from('articles').select('*').in('id', ids).then((r) => (r.data ?? []) as Article[]) : Promise.resolve([] as Article[]),
      bon.vehicle_id ? supabase.from('vehicles').select('*').eq('id', bon.vehicle_id).maybeSingle().then((r) => r.data as Vehicle | null) : Promise.resolve(null),
      fetchPeople(),
    ]);
    return { bon, lignes, amap: new Map(articles.map((a) => [a.id, a])), vehicle, auteur: people.find((p) => p.id === bon.auteur_id)?.full_name };
  }, [id]);

  // Après validation, la fenêtre d'impression s'ouvre directement.
  useEffect(() => {
    if (data && params.get('imprimer') === '1') {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [data, params]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Bon introuvable'}</ErrorBox>;
  const { bon, lignes, amap } = data;
  const reception = bon.type === 'reception';
  const total = lignes.reduce((s, l) => s + l.quantite * (l.prix_unitaire ?? 0), 0);

  return (
    <div className="space-y-4">
      <style>{'@page { size: A5 portrait; margin: 7mm; } @media print { html, body, #root, main { background: #fff !important; } }'}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/magasin/bons" className="text-sm text-sky-700 hover:underline">← Tous les bons</Link>
        <div className="flex gap-2">
          <Link to={`/magasin/bon/${bon.type}`}><Button variant="secondary">+ Nouveau bon</Button></Link>
          <Button onClick={() => window.print()}>🖨 Imprimer (A5)</Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[148mm] bg-white p-5 text-[11px] leading-snug text-black shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <div className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <div>
              <div className="text-sm font-bold">VALORISE MAROC</div>
              <div className="text-[10px]">Magasin · Gestion de stock</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-bold uppercase">{reception ? 'Bon de réception' : 'Bon de livraison'}</div>
            <div className="font-mono text-[13px] font-bold">N° {bon.numero}</div>
            <div>Date : {fmtDate(bon.date_bon)}</div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
          {reception ? (
            <>
              <div><b>Fournisseur :</b> {bon.tiers ?? '—'}</div>
              <div><b>N° BL / facture :</b> {bon.reference_tiers ?? '—'}</div>
              <div><b>Réceptionné par :</b> {bon.demandeur ?? '—'}</div>
            </>
          ) : (
            <>
              <div><b>Véhicule / engin :</b> {data.vehicle ? vehicleLabel(data.vehicle) : '—'}</div>
              <div><b>Destinataire :</b> {bon.tiers ?? '—'}</div>
              <div><b>Demandeur :</b> {bon.demandeur ?? '—'}</div>
              <div><b>Motif :</b> {MOUVEMENT_MOTIF[lignes[0]?.motif ?? ''] ?? '—'}</div>
            </>
          )}
          <div><b>Saisi par :</b> {data.auteur ?? '—'}</div>
        </div>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="bg-slate-100 print:bg-transparent">
              <th className="border border-black px-1 py-0.5 text-left">#</th>
              <th className="border border-black px-1 py-0.5 text-left">Code</th>
              <th className="border border-black px-1 py-0.5 text-left">Désignation</th>
              <th className="border border-black px-1 py-0.5 text-left">Empl.</th>
              <th className="border border-black px-1 py-0.5 text-right">Qté</th>
              {reception && <th className="border border-black px-1 py-0.5 text-right">PU</th>}
              {reception && <th className="border border-black px-1 py-0.5 text-right">Total</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const a = amap.get(l.article_id);
              return (
                <tr key={l.id}>
                  <td className="border border-black px-1 py-0.5">{i + 1}</td>
                  <td className="border border-black px-1 py-0.5 font-mono">{a?.code}</td>
                  <td className="border border-black px-1 py-0.5">{a?.designation}</td>
                  <td className="border border-black px-1 py-0.5 font-mono">{a?.emplacement ?? ''}</td>
                  <td className="border border-black px-1 py-0.5 text-right whitespace-nowrap">{fmtNumber(l.quantite, 2)} {a?.unite}</td>
                  {reception && <td className="border border-black px-1 py-0.5 text-right whitespace-nowrap">{l.prix_unitaire != null ? fmtNumber(l.prix_unitaire, 2) : ''}</td>}
                  {reception && <td className="border border-black px-1 py-0.5 text-right whitespace-nowrap">{l.prix_unitaire != null ? fmtNumber(l.quantite * l.prix_unitaire, 2) : ''}</td>}
                </tr>
              );
            })}
          </tbody>
          {reception && total > 0 && (
            <tfoot>
              <tr><td colSpan={6} className="border border-black px-1 py-0.5 text-right font-bold">Total</td><td className="border border-black px-1 py-0.5 text-right font-bold whitespace-nowrap">{fmtMoney(total)}</td></tr>
            </tfoot>
          )}
        </table>
        <div className="mt-1">{lignes.length} ligne(s)</div>
        {bon.commentaire && <div className="mt-1"><b>Observation :</b> {bon.commentaire}</div>}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="h-20 border border-black p-1"><b>{reception ? 'Livreur / fournisseur' : 'Magasinier'}</b><div className="text-[9px]">Nom et signature</div></div>
          <div className="h-20 border border-black p-1"><b>{reception ? 'Magasinier' : 'Reçu par'}</b><div className="text-[9px]">Nom et signature</div></div>
        </div>
        <div className="mt-2 text-center text-[9px] text-slate-600">Édité le {fmtDateTime(bon.created_at)} · {bon.numero}</div>
      </div>
    </div>
  );
}
