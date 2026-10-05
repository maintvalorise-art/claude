import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../../components/ui';
import type { Vehicle } from '../../lib/types';

/** Libellé bilingue français · arabe. */
export function L({ fr, ar, req }: { fr: string; ar: string; req?: boolean }) {
  return <>{fr}{req && ' *'} <span className="ar text-slate-500">· {ar}</span></>;
}

/** Véhicule attribué au chauffeur, sinon le premier de la liste. */
export function defaultVehicle(vehicles: Vehicle[], userId: string | undefined) {
  return vehicles.find((v) => v.chauffeur_id === userId)?.id ?? '';
}

export function Done({ title, children, onNew }: { title: string; children?: ReactNode; onNew: () => void }) {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <div className="space-y-4 text-center">
          <div className="text-5xl">✅</div>
          <h1 className="text-xl font-bold">{title}</h1>
          {children}
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/"><Button variant="secondary">Accueil · الرئيسية</Button></Link>
            <Button onClick={onNew}>Nouvelle saisie · إدخال جديد</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
