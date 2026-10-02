import { useState } from 'react';
import { delaiEcheance, fmtDate } from '../lib/format';
import { ALERT_LEVEL, DOCUMENT_TYPE_LABELS } from '../lib/labels';
import { errorMessage, supabase } from '../lib/supabase';
import type { DocumentRow, Echeance } from '../lib/types';
import { must, useAsync } from '../lib/useAsync';
import DocumentForm, { type DocOwner } from './DocumentForm';
import { Button, Card, Empty, ErrorBox, Modal, Spinner, StatusBadge, Table, Td } from './ui';

/** Liste des papiers d'un véhicule ou d'un chauffeur, avec ajout / renouvellement. */
export default function DocumentsPanel({ owner, title = 'Papiers & échéances' }: { owner: DocOwner; title?: string }) {
  const col = 'vehicle_id' in owner ? 'vehicle_id' : 'chauffeur_id';
  const ownerId = 'vehicle_id' in owner ? owner.vehicle_id : owner.chauffeur_id;
  const [edit, setEdit] = useState<{ doc?: DocumentRow; renew?: boolean } | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [docs, ech] = await Promise.all([
      supabase.from('documents').select('*').eq(col, ownerId).order('date_expiration').then(must),
      supabase.from('v_echeances').select('*').eq('source', 'document').eq(col, ownerId).then(must),
    ]);
    return { docs: docs as DocumentRow[], ech: new Map((ech as Echeance[]).map((e) => [e.id, e])) };
  }, [ownerId]);

  async function remove(doc: DocumentRow) {
    if (!confirm(`Supprimer définitivement « ${DOCUMENT_TYPE_LABELS[doc.type]} » ?`)) return;
    const { error: err } = await supabase.from('documents').delete().eq('id', doc.id);
    if (err) setActionError(errorMessage(err));
    else void reload();
  }

  const docs = data?.docs.filter((d) => showArchive || !d.archive) ?? [];

  return (
    <Card
      title={title}
      actions={
        <>
          <Button variant="ghost" onClick={() => setShowArchive((s) => !s)}>{showArchive ? 'Masquer historique' : 'Historique'}</Button>
          <Button onClick={() => setEdit({})}>+ Ajouter</Button>
        </>
      }
    >
      <ErrorBox>{actionError}</ErrorBox>
      {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : docs.length === 0 ? <Empty>Aucun papier enregistré.</Empty> : (
        <Table head={['Papier', 'Référence', 'Expiration', 'État', '']}>
          {docs.map((d) => {
            const e = data!.ech.get(d.id);
            return (
              <tr key={d.id} className={d.archive ? 'opacity-50' : ''}>
                <Td>
                  <div className="font-medium">{DOCUMENT_TYPE_LABELS[d.type]}</div>
                  {d.libelle && <div className="text-xs text-slate-500">{d.libelle}</div>}
                </Td>
                <Td>{d.reference ?? '—'}</Td>
                <Td>
                  {fmtDate(d.date_expiration)}
                  {e && <div className="text-xs text-slate-500">{delaiEcheance(e)}</div>}
                </Td>
                <Td>{d.archive ? 'Archivé' : e ? <StatusBadge map={ALERT_LEVEL} value={e.niveau} /> : null}</Td>
                <Td className="whitespace-nowrap text-right">
                  {!d.archive && (
                    <>
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEdit({ doc: d, renew: true })}>Renouveler</Button>{' '}
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEdit({ doc: d })}>Modifier</Button>
                    </>
                  )}
                  <Button variant="ghost" className="px-2 py-1 text-xs text-red-600" onClick={() => remove(d)}>✕</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.renew ? 'Renouveler le papier' : edit?.doc ? 'Modifier le papier' : 'Ajouter un papier'}
      >
        {edit && (
          <DocumentForm owner={owner} doc={edit.doc} renew={edit.renew} onDone={() => { setEdit(null); void reload(); }} />
        )}
      </Modal>
    </Card>
  );
}
