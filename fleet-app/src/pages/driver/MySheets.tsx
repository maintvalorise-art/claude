import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles } from '../../lib/data';
import { fmtDate, fmtNumber } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { ControlSheet } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function MySheets() {
  const { profile } = useAuth();
  const { data, loading, error } = useAsync(async () => {
    const [vehicles, sheets] = await Promise.all([
      fetchVehicles(false),
      supabase.from('control_sheets').select('*').eq('chauffeur_id', profile!.id).order('created_at', { ascending: false }).limit(100).then(must),
    ]);
    return { vehicles: new Map(vehicles.map((v) => [v.id, v.matricule])), sheets: sheets as ControlSheet[] };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={<>Mes fiches de contrôle <span className="ar text-slate-500">· أوراق المراقبة</span></>} />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : data!.sheets.length === 0 ? <Empty>Aucune fiche.</Empty> : (
          <Table head={['Date', 'Véhicule', 'Compteur', 'Résultat', '']}>
            {data!.sheets.map((s) => (
              <tr key={s.id}>
                <Td>{fmtDate(s.date_controle)}</Td>
                <Td className="font-medium">{data!.vehicles.get(s.vehicle_id)}</Td>
                <Td>{fmtNumber(s.compteur_depart)}</Td>
                <Td>{s.nb_nok ? <Badge tone="red">{s.nb_nok} NOK</Badge> : <Badge tone="green">Tout OK</Badge>}</Td>
                <Td><Link className="text-sky-700 underline" to={`/fiches/${s.id}`}>Voir</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
