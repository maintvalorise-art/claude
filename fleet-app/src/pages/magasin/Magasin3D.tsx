import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Spinner } from '../../components/ui';
import { fetchArticles } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { ENTREE, ETAGES, PLAN, RACKS, formatEmplacement, libelleEmplacement, parseEmplacement, useCasesParRack, type Rack } from '../../lib/stock';
import type { Article } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

// Dimensions (en mètres, approximatives) d'une case de rack.
const CW = 1.0; // largeur d'une case
const D = 0.9; // profondeur du rack
const H = 0.75; // hauteur d'un étage

type Etat = 'ok' | 'min' | 'rupture';
const COULEUR: Record<Etat, number> = { ok: 0x16a34a, min: 0xf59e0b, rupture: 0xdc2626 };

function etatArticle(a: Article): Etat {
  return a.stock_actuel <= 0 ? 'rupture' : a.stock_actuel < a.stock_min ? 'min' : 'ok';
}

function etatCase(list: Article[]): Etat {
  return list.some((a) => etatArticle(a) === 'rupture') ? 'rupture' : list.some((a) => etatArticle(a) === 'min') ? 'min' : 'ok';
}

/** Étiquette texte toujours face à la caméra. */
function label(text: string, size: number, color = '#0f172a', bg?: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(8, 8, 240, 112, 24);
    g.fill();
  }
  g.fillStyle = color;
  g.font = 'bold 84px system-ui, sans-serif';
  // Texte long (« ENTRÉE ») : police réduite pour tenir dans l'étiquette.
  const w = g.measureText(text).width;
  if (w > 220) g.font = `bold ${Math.floor((84 * 220) / w)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(size * 2, size, 1);
  return s;
}

interface Scene3D {
  select: (code: string | null, fly?: boolean) => void;
  overview: () => void;
}

/** Magasin en 3D : racks A à G le long des murs, 4 étages ; chaque article est rangé dans sa case. */
export default function Magasin3D() {
  const [params, setParams] = useSearchParams();
  const casesParam = useCasesParRack();
  const { data: articles, loading, error } = useAsync(() => fetchArticles(true));
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');

  // Articles regroupés par case « A-2-3 ».
  const { parCase, sansPlace, cases } = useMemo(() => {
    const m = new Map<string, Article[]>();
    const sans: Article[] = [];
    const cases = { ...casesParam };
    for (const a of articles ?? []) {
      const e = parseEmplacement(a.emplacement);
      if (!e) {
        sans.push(a);
        continue;
      }
      cases[e.rack] = Math.max(cases[e.rack], e.case);
      const k = formatEmplacement(e);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return { parCase: m, sansPlace: sans, cases };
  }, [articles, casesParam]);

  const trouves = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return [];
    return (articles ?? []).filter((a) => `${a.code} ${a.designation} ${a.ref_fabricant ?? ''} ${a.emplacement ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [recherche, articles]);

  // Construction de la scène.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !articles) return;

    const hauteur = ETAGES * H;
    // Chaque rack est construit dans son repère : longueur sur +X, face avant (allée) vers +Z.
    const groupes = new Map<Rack, THREE.Group>();
    const axe = (r: Rack) => new THREE.Vector3(Math.cos(PLAN[r].angle), 0, -Math.sin(PLAN[r].angle));
    const devant = (r: Rack) => new THREE.Vector3(Math.sin(PLAN[r].angle), 0, Math.cos(PLAN[r].angle));
    const centre = (rack: Rack, etage: number, c: number) =>
      groupes.get(rack)!.localToWorld(new THREE.Vector3((c - 0.5) * CW, (etage - 1) * H + 0.06 + H * 0.32, 0));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8eef5);
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
    scene.add(sun);

    // Racks : montants bleus, lisses orange, plateaux gris.
    const montantMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8 });
    const lisseMat = new THREE.MeshStandardMaterial({ color: 0xea580c });
    const plateauMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
    const montantGeo = new THREE.BoxGeometry(0.06, hauteur + 0.15, 0.06);
    const pickables: THREE.Mesh[] = [];
    const pickGeo = new THREE.BoxGeometry(CW * 0.96, H * 0.9, D);
    const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const binGeo = new THREE.BoxGeometry(CW * 0.78, H * 0.6, D * 0.75);
    const binMat = (e: Etat) => new THREE.MeshStandardMaterial({ color: COULEUR[e], roughness: 0.6 });

    for (const rack of RACKS) {
      const n = cases[rack];
      const L = n * CW;
      const g = new THREE.Group();
      const u = axe(rack);
      g.rotation.y = PLAN[rack].angle;
      g.position.set(PLAN[rack].cx - (u.x * L) / 2, 0, PLAN[rack].cz - (u.z * L) / 2);
      scene.add(g);
      groupes.set(rack, g);
      for (let c = 0; c <= n; c++) {
        for (const dz of [-D / 2, D / 2]) {
          const m = new THREE.Mesh(montantGeo, montantMat);
          m.position.set(c * CW, (hauteur + 0.15) / 2, dz);
          m.castShadow = true;
          g.add(m);
        }
      }
      const lisseGeo = new THREE.BoxGeometry(L, 0.07, 0.05);
      const plateauGeo = new THREE.BoxGeometry(L, 0.03, D);
      for (let e = 0; e <= ETAGES; e++) {
        const y = e * H + 0.04;
        const p = new THREE.Mesh(plateauGeo, plateauMat);
        p.position.set(L / 2, y, 0);
        p.receiveShadow = true;
        g.add(p);
        for (const dz of [-D / 2, D / 2]) {
          const l = new THREE.Mesh(lisseGeo, lisseMat);
          l.position.set(L / 2, y, dz);
          g.add(l);
        }
      }
      // Lettre du rack au-dessus du milieu, numéros d'étage à gauche, numéros de case devant.
      const lettre = label(rack, 1, '#ffffff', '#1d4ed8');
      lettre.position.set(L / 2, hauteur + 0.7, 0);
      g.add(lettre);
      for (let e = 1; e <= ETAGES; e++) {
        const s = label(String(e), 0.32, '#334155');
        s.position.set(-0.3, (e - 1) * H + H / 2, 0);
        g.add(s);
      }
      for (let c = 1; c <= n; c++) {
        const s = label(String(c), 0.28, '#475569');
        s.position.set((c - 0.5) * CW, 0.18, D / 2 + 0.35);
        g.add(s);
        for (let e = 1; e <= ETAGES; e++) {
          const code = formatEmplacement({ rack, etage: e, case: c });
          const local = new THREE.Vector3((c - 0.5) * CW, (e - 1) * H + 0.06 + H * 0.32, 0);
          const pick = new THREE.Mesh(pickGeo, pickMat);
          pick.position.copy(local);
          pick.userData.code = code;
          g.add(pick);
          pickables.push(pick);
          const list = parCase.get(code);
          if (list) {
            const bin = new THREE.Mesh(binGeo, binMat(etatCase(list)));
            bin.position.copy(local);
            bin.castShadow = true;
            g.add(bin);
          }
        }
      }
      g.updateMatrixWorld(true);
    }

    // Sol et murs : rectangle autour des racks, entrée dans le mur du bas entre A et G.
    const boite = new THREE.Box3();
    for (const g of groupes.values()) boite.expandByObject(g);
    const xMin = boite.min.x - 1.2, xMax = boite.max.x + 1.2, zMin = boite.min.z - 1.2, zMax = boite.max.z + 1.2;
    const solL = xMax - xMin;
    const solP = zMax - zMin;
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(solL, solP), new THREE.MeshStandardMaterial({ color: 0xcbd5e1 }));
    sol.rotation.x = -Math.PI / 2;
    sol.position.set((xMin + xMax) / 2, 0, (zMin + zMax) / 2);
    sol.receiveShadow = true;
    scene.add(sol);
    const grille = new THREE.GridHelper(Math.ceil(Math.max(solL, solP)), Math.ceil(Math.max(solL, solP)), 0xb6c2d1, 0xb6c2d1);
    grille.position.set((xMin + xMax) / 2, 0.002, (zMin + zMax) / 2);
    scene.add(grille);
    const murMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 });
    const mur = (x1: number, z1: number, x2: number, z2: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(Math.abs(x2 - x1), 0.15), 1.2, Math.max(Math.abs(z2 - z1), 0.15)), murMat);
      m.position.set((x1 + x2) / 2, 0.6, (z1 + z2) / 2);
      scene.add(m);
    };
    const porteG = ENTREE.x - ENTREE.largeur / 2, porteD = ENTREE.x + ENTREE.largeur / 2;
    mur(xMin, zMin, xMax, zMin);
    mur(xMin, zMin, xMin, zMax);
    mur(xMax, zMin, xMax, zMax);
    mur(xMin, zMax, porteG, zMax);
    mur(porteD, zMax, xMax, zMax);
    const seuil = new THREE.Mesh(new THREE.PlaneGeometry(ENTREE.largeur, 1.6), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
    seuil.rotation.x = -Math.PI / 2;
    seuil.position.set(ENTREE.x, 0.004, zMax - 0.6);
    scene.add(seuil);
    const flecheEntree = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 3), new THREE.MeshStandardMaterial({ color: 0x15803d }));
    flecheEntree.rotation.set(-Math.PI / 2, 0, 0);
    flecheEntree.position.set(ENTREE.x, 0.05, zMax - 0.6);
    scene.add(flecheEntree);
    const entree = label('ENTRÉE', 0.55, '#ffffff', '#15803d');
    entree.position.set(ENTREE.x, 1.7, zMax);
    scene.add(entree);

    // Repères de survol et de sélection.
    const survol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CW * 0.98, H * 0.92, D * 1.02)), new THREE.LineBasicMaterial({ color: 0x0ea5e9 }));
    survol.visible = false;
    scene.add(survol);
    const cadre = new THREE.Mesh(new THREE.BoxGeometry(CW * 1.02, H * 0.95, D * 1.08), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.35, depthWrite: false }));
    cadre.visible = false;
    scene.add(cadre);
    const fleche = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 20), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04 }));
    fleche.rotation.x = Math.PI;
    fleche.visible = false;
    scene.add(fleche);

    // Déplacement fluide de la caméra.
    let anim: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; start: number } | null = null;
    const voler = (pos: THREE.Vector3, cible: THREE.Vector3) => {
      anim = { p0: camera.position.clone(), p1: pos, t0: controls.target.clone(), t1: cible, start: performance.now() };
    };
    // Vue d'ensemble depuis l'entrée : plus de recul sur un écran étroit (téléphone en portrait).
    const milieu = new THREE.Vector3((xMin + xMax) / 2, 0, (zMin + zMax) / 2);
    const posGenerale = () => new THREE.Vector3(1.5, solL * 0.7, solP * 1.25).multiplyScalar(Math.max(1, 1.3 / camera.aspect)).add(milieu);
    const vueGenerale = () => voler(posGenerale(), milieu.clone());
    camera.position.copy(posGenerale());
    controls.target.copy(milieu);

    let selCode: string | null = null;
    const select = (code: string | null, fly = true) => {
      selCode = code;
      const e = parseEmplacement(code);
      if (!e) {
        cadre.visible = fleche.visible = false;
        return;
      }
      const pos = centre(e.rack, e.etage, e.case);
      cadre.position.copy(pos);
      cadre.rotation.y = PLAN[e.rack].angle;
      fleche.position.set(pos.x, hauteur + 0.9, pos.z);
      cadre.visible = fleche.visible = true;
      // Vue de trois quarts depuis le centre du magasin, face au rack.
      if (fly) voler(pos.clone().addScaledVector(devant(e.rack), 3.6).addScaledVector(axe(e.rack), 1.4).add(new THREE.Vector3(0, 1.3, 0)), pos.clone());
    };
    sceneRef.current = { select, overview: vueGenerale };

    // Survol et clic (un glisser ne sélectionne pas).
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      return (ray.intersectObjects(pickables, false)[0]?.object.userData.code as string | undefined) ?? null;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (ev: PointerEvent) => {
      const code = pick(ev);
      setHover(code);
      const e = parseEmplacement(code);
      survol.visible = !!e;
      if (e) {
        survol.position.copy(centre(e.rack, e.etage, e.case));
        survol.rotation.y = PLAN[e.rack].angle;
      }
      renderer.domElement.style.cursor = code ? 'pointer' : 'grab';
    };
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
      const code = pick(ev);
      if (code) setSelected(code);
    };
    const onLeave = () => {
      survol.visible = false;
      setHover(null);
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);

    renderer.setAnimationLoop((t) => {
      if (anim) {
        const k = Math.min(1, (t - anim.start) / 900);
        const ease = 1 - (1 - k) ** 3;
        camera.position.lerpVectors(anim.p0, anim.p1, ease);
        controls.target.lerpVectors(anim.t0, anim.t1, ease);
        if (k >= 1) anim = null;
      }
      if (selCode) {
        (cadre.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(t / 180);
        fleche.position.y = hauteur + 0.9 + 0.15 * Math.sin(t / 250);
      }
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          (mat as THREE.SpriteMaterial).map?.dispose();
          mat.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [articles, parCase, cases]);

  // Sélection demandée par l'adresse : ?emp=A-2-3 ou ?article=<id>.
  useEffect(() => {
    if (!articles) return;
    const art = params.get('article');
    const code = art ? articles.find((a) => a.id === art)?.emplacement : params.get('emp');
    const e = parseEmplacement(code);
    setSelected(e ? formatEmplacement(e) : null);
  }, [articles, params]);

  useEffect(() => {
    sceneRef.current?.select(selected);
  }, [selected, cases, parCase]);

  function choisir(code: string | null, articleId?: string) {
    setRecherche('');
    const next = new URLSearchParams();
    if (articleId) next.set('article', articleId);
    else if (code) next.set('emp', code);
    setParams(next, { replace: true });
    setSelected(code);
  }

  if (loading) return <Spinner />;
  if (error || !articles) return <ErrorBox>{error}</ErrorBox>;

  const contenu = selected ? parCase.get(selected) ?? [] : [];
  const articleDemande = params.get('article') ? articles.find((a) => a.id === params.get('article')) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="🏬 Magasin 3D"
        subtitle={`Racks A à G le long des murs · ${ETAGES} étages · ${RACKS.map((r) => `${r} ${cases[r]}`).join(', ')} cases. Faites tourner avec la souris ou le doigt, cliquez sur une case pour voir son contenu.`}
        actions={<Link to="/magasin"><Button variant="secondary">📋 Liste du stock</Button></Link>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          <div ref={mountRef} className="h-[62vh] min-h-[360px] w-full touch-none" />
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/90 px-3 py-1.5 text-xs shadow">
            {hover ? <><b>{hover}</b> · {(parCase.get(hover) ?? []).length} article(s)</> : 'Survolez une case'}
          </div>
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-white/90 px-2 py-1 shadow"><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-green-600 align-middle" />En stock</span>
            <span className="rounded bg-white/90 px-2 py-1 shadow"><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-amber-500 align-middle" />Sous le min</span>
            <span className="rounded bg-white/90 px-2 py-1 shadow"><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-red-600 align-middle" />Rupture</span>
          </div>
          <div className="absolute right-3 top-3">
            <Button variant="secondary" onClick={() => { choisir(null); sceneRef.current?.overview(); }}>Vue d'ensemble</Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card title="🔎 Trouver un article">
            <div className="relative">
              <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Code, désignation, emplacement…" />
              {trouves.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {trouves.map((a) => {
                    const e = parseEmplacement(a.emplacement);
                    return (
                      <li key={a.id}>
                        <button type="button" disabled={!e} onClick={() => choisir(e ? formatEmplacement(e) : null, a.id)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60">
                          <b>{a.code}</b> · {a.designation}
                          <span className="block text-xs text-slate-500">{e ? `📍 ${formatEmplacement(e)}` : 'Sans emplacement'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card title={selected ? <>📍 {libelleEmplacement(selected)}</> : 'Case sélectionnée'}>
            {!selected ? <p className="text-sm text-slate-500">Cliquez sur une case du magasin ou cherchez un article.</p>
              : contenu.length === 0 ? <p className="text-sm text-slate-500">Case vide.</p> : (
                <ul className="-my-2 divide-y divide-slate-100">
                  {contenu.map((a) => (
                    <li key={a.id} className={`py-2 text-sm ${articleDemande?.id === a.id ? 'font-semibold' : ''}`}>
                      <Link to={`/magasin/${a.id}`} className="flex items-center justify-between gap-2 hover:underline">
                        <span>{a.code}<span className="block text-xs font-normal text-slate-500">{a.designation}</span></span>
                        <Badge tone={etatArticle(a) === 'ok' ? 'green' : etatArticle(a) === 'min' ? 'amber' : 'red'}>{fmtNumber(a.stock_actuel)} {a.unite}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Card>

          {sansPlace.length > 0 && (
            <Card title={`Sans emplacement (${sansPlace.length})`}>
              <p className="mb-2 text-xs text-slate-500">Ouvrez l'article et choisissez son rack, son étage et sa case pour le voir dans le magasin.</p>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {sansPlace.map((a) => <li key={a.id}><Link className="text-sky-700 hover:underline" to={`/magasin/${a.id}`}>{a.code}</Link> · {a.designation}</li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
