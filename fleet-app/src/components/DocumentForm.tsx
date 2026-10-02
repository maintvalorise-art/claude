import { useState, type FormEvent } from 'react';
import { DOCUMENT_TYPE_LABELS, DRIVER_DOCUMENT_TYPES, VEHICLE_DOCUMENT_TYPES } from '../lib/labels';
import { errorMessage, supabase } from '../lib/supabase';
import type { DocumentRow, DocumentType, Profile, Vehicle } from '../lib/types';
import { Button, ErrorBox, Field, Input, Select, Textarea } from './ui';

export type DocOwner = { vehicle_id: string } | { chauffeur_id: string };

/**
 * Création / modification / renouvellement d'un papier.
 * - `doc` fourni : modification.
 * - `renew` : crée un nouveau document et archive l'ancien (historique conservé).
 * - Sans `owner`, l'utilisateur choisit le véhicule ou le chauffeur.
 */
export default function DocumentForm({
  owner, doc, renew, vehicles, drivers, onDone,
}: {
  owner?: DocOwner;
  doc?: DocumentRow;
  renew?: boolean;
  vehicles?: Vehicle[];
  drivers?: Profile[];
  onDone: () => void;
}) {
  const initialOwner: 'vehicle' | 'chauffeur' =
    owner ? ('vehicle_id' in owner ? 'vehicle' : 'chauffeur') : doc?.chauffeur_id ? 'chauffeur' : 'vehicle';
  const [ownerKind, setOwnerKind] = useState(initialOwner);
  const [ownerId, setOwnerId] = useState(
    owner ? ('vehicle_id' in owner ? owner.vehicle_id : owner.chauffeur_id) : doc?.vehicle_id ?? doc?.chauffeur_id ?? '',
  );
  const types = ownerKind === 'vehicle' ? VEHICLE_DOCUMENT_TYPES : DRIVER_DOCUMENT_TYPES;
  const [type, setType] = useState<DocumentType>(doc?.type ?? types[0]);
  const [libelle, setLibelle] = useState(doc?.libelle ?? '');
  const [reference, setReference] = useState(renew ? '' : doc?.reference ?? '');
  const [dateEmission, setDateEmission] = useState(renew ? '' : doc?.date_emission ?? '');
  const [dateExpiration, setDateExpiration] = useState(renew ? '' : doc?.date_expiration ?? '');
  const [rappel, setRappel] = useState(String(doc?.rappel_jours ?? 30));
  const [notes, setNotes] = useState(renew ? '' : doc?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const row = {
      vehicle_id: ownerKind === 'vehicle' ? ownerId : null,
      chauffeur_id: ownerKind === 'chauffeur' ? ownerId : null,
      type,
      libelle: libelle.trim() || null,
      reference: reference.trim() || null,
      date_emission: dateEmission || null,
      date_expiration: dateExpiration,
      rappel_jours: Number(rappel) || 0,
      notes: notes.trim() || null,
    };
    try {
      if (doc && !renew) {
        const { error: err } = await supabase.from('documents').update(row).eq('id', doc.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('documents').insert(row);
        if (err) throw err;
        if (doc && renew) {
          const { error: err2 } = await supabase.from('documents').update({ archive: true }).eq('id', doc.id);
          if (err2) throw err2;
        }
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!owner && !doc && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Concerne">
            <Select
              value={ownerKind}
              onChange={(e) => {
                const k = e.target.value as 'vehicle' | 'chauffeur';
                setOwnerKind(k);
                setOwnerId('');
                setType((k === 'vehicle' ? VEHICLE_DOCUMENT_TYPES : DRIVER_DOCUMENT_TYPES)[0]);
              }}
            >
              <option value="vehicle">Un véhicule / engin</option>
              <option value="chauffeur">Un chauffeur</option>
            </Select>
          </Field>
          <Field label={ownerKind === 'vehicle' ? 'Véhicule *' : 'Chauffeur *'}>
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>
              <option value="">— Choisir —</option>
              {ownerKind === 'vehicle'
                ? vehicles?.map((v) => <option key={v.id} value={v.id}>{v.matricule} {v.marque ?? ''}</option>)
                : drivers?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </Select>
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type de papier *">
          <Select value={type} onChange={(e) => setType(e.target.value as DocumentType)} disabled={renew}>
            {types.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Libellé" hint="Ex. compagnie d'assurance, centre de visite…">
          <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
        </Field>
        <Field label="N° / référence">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Date d'émission">
          <Input type="date" value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} />
        </Field>
        <Field label="Date d'expiration *">
          <Input type="date" value={dateExpiration} onChange={(e) => setDateExpiration(e.target.value)} required />
        </Field>
        <Field label="M'alerter (jours avant)" hint="Alerte « urgent » à 7 jours">
          <Input type="number" min={0} max={365} value={rappel} onChange={(e) => setRappel(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy || !ownerId} className="w-full">
        {busy ? 'Enregistrement…' : renew ? 'Enregistrer le renouvellement' : 'Enregistrer'}
      </Button>
    </form>
  );
}
