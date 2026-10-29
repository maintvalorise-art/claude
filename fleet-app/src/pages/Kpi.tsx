import { useState, type ReactNode } from 'react';
import { moduleOn } from '../lib/config';
import { Card, ErrorBox, Field, Input, PageHeader, Spinner, StatCard } from '../components/ui';
import { daysAgoIso, fmtMoney, fmtNumber, todayIso } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Kpis } from '../lib/types';
import { must, useAsync } from '../lib/useAsync';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${fmtNumber(v, 1)} %`);

export default function Kpi() {
  const [debut, setDebut] = useState(daysAgoIso(30));
  const [fin, setFin] = useState(todayIso());
  const { data, loading, error } = useAsync(
    async () => must(await supabase.rpc('kpis', { p_debut: debut, p_fin: fin })) as Kpis,
    [debut, fin],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pilotage · indicateurs de performance"
        subtitle={moduleOn('achats') ? 'Achats, magasin, flotte et bennes' : moduleOn('magasin') ? 'Fleet management et gestion de stock' : 'Fleet management'}
        actions={
          <div className="flex items-end gap-2 print:hidden">
            <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
            <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
          </div>
        }
      />
      {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
        <>
          {moduleOn('achats') && (
          <Section title="🛒 Achats" hint="Mensuel / trimestriel">
            <StatCard label="Demandes d'achat" value={data.achats.nb_da} />
            <StatCard label="Délai moyen DA → commande" value={data.achats.delai_moyen_commande_h == null ? '—' : `${fmtNumber(data.achats.delai_moyen_commande_h, 1)} h`} tone="blue" />
            <StatCard label="Prise en charge dans le délai" value={pct(data.achats.pct_prise_en_charge_delai)} tone={tone(data.achats.pct_prise_en_charge_delai, 90)} />
            <StatCard label="Commandes dans le délai cible" value={pct(data.achats.pct_commande_delai)} tone={tone(data.achats.pct_commande_delai, 90)} />
            <StatCard label="Taux de service fournisseurs" value={pct(data.achats.taux_service_fournisseurs)} tone={tone(data.achats.taux_service_fournisseurs, 90)} hint="Livraisons à la date promise" />
            <StatCard label="Économies négociées" value={fmtMoney(data.achats.economies_negociees)} tone="green" hint="Estimé − commandé" />
            <StatCard label="Montant commandé" value={fmtMoney(data.achats.montant_commande)} />
          </Section>
          )}
          {moduleOn('magasin') && (
          <Section title="📦 Gestion de stock" hint="Mensuel">
            <StatCard label="Ruptures sur pièces A" value={data.magasin.ruptures_a} tone={data.magasin.ruptures_a ? 'red' : 'green'} />
            <StatCard label="Articles sous stock min" value={data.magasin.sous_minimum} tone={data.magasin.sous_minimum ? 'amber' : 'green'} />
            <StatCard label="Valeur du stock" value={fmtMoney(data.magasin.valeur_stock)} tone="blue" />
            <StatCard label="Fiabilité d'inventaire" value={pct(data.magasin.fiabilite_inventaire)} tone={tone(data.magasin.fiabilite_inventaire, 95)} hint="Dernier inventaire clôturé" />
            <StatCard label="Articles dormants (6 mois)" value={data.magasin.articles_dormants} />
          </Section>
          )}
          {moduleOn('flotte') && (
          <Section title="🚚 Fleet" hint="Mensuel / hebdomadaire">
            <StatCard label="Disponibilité du parc" value={pct(data.flotte.disponibilite_pct)} tone={tone(data.flotte.disponibilite_pct, 90)} hint={`${data.flotte.nb_vehicules} véhicule(s)`} />
            <StatCard label="Coût de maintenance" value={fmtMoney(data.flotte.cout_maintenance)} hint={data.flotte.nb_vehicules ? `${fmtMoney(data.flotte.cout_maintenance / data.flotte.nb_vehicules)} / véhicule` : undefined} />
            <StatCard label="Consommation camions" value={data.flotte.conso_l_100km == null ? '—' : `${fmtNumber(data.flotte.conso_l_100km, 1)} L/100 km`} tone="blue" />
            <StatCard label="Consommation engins" value={data.flotte.conso_l_h == null ? '—' : `${fmtNumber(data.flotte.conso_l_h, 1)} L/h`} tone="blue" />
            <StatCard label="Gasoil consommé" value={`${fmtNumber(data.flotte.gasoil_litres)} L`} />
            <StatCard label="Accidents" value={data.flotte.accidents} tone={data.flotte.accidents ? 'red' : 'green'} />
            <StatCard label="Documents expirés" value={data.flotte.documents_expires} tone={data.flotte.documents_expires ? 'red' : 'green'} />
            <StatCard label="Fiches de contrôle réalisées" value={pct(data.flotte.taux_fiches_controle)} tone={tone(data.flotte.taux_fiches_controle, 100)} hint="Véhicules attribués, période en cours" />
          </Section>
          )}
          {moduleOn('bennes') && (
          <Section title="🗑 Bennes" hint="Mensuel">
            <StatCard label="Bennes chez les clients" value={`${data.bennes.chez_client} / ${data.bennes.nb_bennes}`} tone="blue" />
            <StatCard label="Disponibles au dépôt" value={data.bennes.au_depot} tone="green" />
            <StatCard label="Rotations (poses)" value={data.bennes.rotations} hint={data.bennes.taux_rotation == null ? undefined : `${fmtNumber(data.bennes.taux_rotation, 2)} par benne`} />
            <StatCard label="Durée moyenne chez client" value={data.bennes.duree_moyenne_client_j == null ? '—' : `${fmtNumber(data.bennes.duree_moyenne_client_j, 1)} j`} />
            <StatCard label="Non localisées (> 30 j)" value={data.bennes.non_localisees} tone={data.bennes.non_localisees ? 'red' : 'green'} />
          </Section>
          )}
        </>
      )}
    </div>
  );
}

function tone(v: number | null | undefined, cible: number) {
  if (v == null) return 'gray' as const;
  return v >= cible ? ('green' as const) : v >= cible - 15 ? ('amber' as const) : ('red' as const);
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card title={<>{title} <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span></>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </Card>
  );
}
