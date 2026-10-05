import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ScanInput from '../../components/ScanInput';
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Spinner, SuccessBox, Table, Td } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchArticles } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { can } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Inventaire, InventaireLigne } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function InventaireDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const gerer = can(profile, 'magasinGerer');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const { data, loading, reload, setData } = useAsync(async () => {
    const [inv, lignes, articles] = await Promise.all([
      supabase.from('inventaires').select('*').eq('id', id!).single().then(must),
      supabase.from('inventaire_lignes').select('*').eq('inventaire_id', id!).then(must),
      fetchArticles(false),
    ]);
    return { inv: inv as Inventaire, lignes: lignes as InventaireLigne[], amap: byId(articles) };
  }, [id]);

  if (loading || !data) return <Spinner />;
  const ouvert = data.inv.statut === 'en_cours' && gerer;
  const comptes = data.lignes.filter((l) => l.qte_comptee != null).length;
  const sorted = [...data.lignes].sort((a, b) => (data.amap.get(a.article_id)?.emplacement ?? '').localeCompare(data.amap.get(b.article_id)?.emplacement ?? ''));

  async function save(articleId: string, value: string) {
    const q = value === '' ? null : Number(value);
    const { error: err } = await supabase.from('inventaire_lignes').update({ qte_comptee: q }).eq('inventaire_id', id!).eq('article_id', articleId);
    if (err) return setError(errorMessage(err));
    setData((d) => d && { ...d, lignes: d.lignes.map((l) => (l.article_id === articleId ? { ...l, qte_comptee: q } : l)) });
  }

  async function cloturer() {
    setError(null);
    const { data: n, error: err } = await supabase.rpc('cloturer_inventaire', { p_id: id });
    if (err) return setError(errorMessage(err));
    setMsg(`Inventaire clôturé : ${n} écart(s) ajusté(s) dans le stock.`);
    void reload();
  }

  return (
    <div className="space-y-5">
      <div className="text-sm"><Link to="/magasin/inventaires" className="text-sky-700 hover:underline">← Inventaires</Link></div>
      <PageHeader
        title={`Inventaire ${data.inv.type === 'tournant' ? 'tournant (pièces A)' : 'complet'}`}
        subtitle={`${comptes} / ${data.lignes.length} article(s) compté(s)`}
        actions={ouvert && <Button onClick={cloturer} disabled={comptes < data.lignes.length}>Clôturer et ajuster le stock</Button>}
      />
      <SuccessBox>{msg}</SuccessBox>
      <ErrorBox>{error}</ErrorBox>
      {ouvert && (
        <Card title="Scanner un article pour le compter">
          <ScanInput onScan={(code) => {
            const a = [...data.amap.values()].find((x) => x.code_barres === code || x.code === code);
            if (!a || !data.lignes.some((l) => l.article_id === a.id)) return setError(`Article « ${code} » absent de cet inventaire`);
            setError(null);
            setFocus(a.id);
            setTimeout(() => document.getElementById(`count-${a.id}`)?.focus(), 50);
          }} />
        </Card>
      )}
      <Card>
        <Table head={['Emplacement', 'Code', 'Désignation', 'Théorique', 'Compté', 'Écart']}>
          {sorted.map((l) => {
            const a = data.amap.get(l.article_id);
            const ecart = l.qte_comptee != null ? l.qte_comptee - l.qte_theorique : null;
            return (
              <tr key={l.article_id} className={focus === l.article_id ? 'bg-amber-50' : ''}>
                <Td>{a?.emplacement ?? '—'}</Td>
                <Td className="font-medium">{a?.code}</Td>
                <Td>{a?.designation}</Td>
                <Td>{fmtNumber(l.qte_theorique)} {a?.unite}</Td>
                <Td>
                  {ouvert ? (
                    <Input id={`count-${l.article_id}`} type="number" min={0} step="any" className="w-24" defaultValue={l.qte_comptee ?? ''} onBlur={(e) => save(l.article_id, e.target.value)} />
                  ) : fmtNumber(l.qte_comptee)}
                </Td>
                <Td>{ecart == null ? '—' : ecart === 0 ? <Badge tone="green">OK</Badge> : <Badge tone="red">{ecart > 0 ? '+' : ''}{fmtNumber(ecart)}</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
