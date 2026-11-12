import { useEffect, useRef, useState } from 'react';
import { loadCesium, type C } from './cesium';
import { PRIORITY, type Config, type Finding } from './types';

type Basemap = 'map' | 'satellite';

interface Api {
  overview: (dur?: number) => void;
  flyTo: (i: number) => void;
  setBasemap: (b: Basemap) => void;
  setBuildingOnly: (on: boolean) => void;
  screenshot: () => void;
}

const OSM_URL = 'https://tile.openstreetmap.org/';
const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [status, setStatus] = useState<string>('Loading the 3D model…');
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [buildingOnly, setBuildingOnly] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(() => window.innerWidth > 720); // collapsed on phones
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    let viewer: C = null;
    let dead = false;
    const cleanups: (() => void)[] = [];

    (async () => {
      const res = await fetch('config.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('config.json missing');
      const config: Config = await res.json();
      if (dead) return;
      setCfg(config);
      document.title = `${config.site.name} – 3D model · ${config.company}`;

      const Cesium = await loadCesium();
      if (dead || !host.current) return;
      Cesium.Ion.defaultAccessToken = '';

      const osm = () => new Cesium.OpenStreetMapImageryProvider({ url: OSM_URL, maximumLevel: 19 });
      const esri = () =>
        new Cesium.UrlTemplateImageryProvider({
          url: ESRI_URL,
          maximumLevel: 19,
          credit: new Cesium.Credit('Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'),
        });

      viewer = new Cesium.Viewer(host.current, {
        baseLayer: new Cesium.ImageryLayer(osm()),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        terrain: undefined,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
      if (import.meta.env.DEV) (window as unknown as { __viewer: C }).__viewer = viewer;
      const scene = viewer.scene;
      scene.globe.depthTestAgainstTerrain = false;
      if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = true;

      // ---- the model (full detail, every tile) ----
      const tileset = await Cesium.Cesium3DTileset.fromUrl(config.model, { maximumScreenSpaceError: 2 });
      if (dead) return;
      scene.primitives.add(tileset);

      // ---- "Building only": inverse polygon clip from the outline ----
      const ring = config.outline?.length ? grow(config.outline, config.outlinePadding ?? 0) : null;
      if (ring && Cesium.ClippingPolygonCollection) {
        tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
          polygons: [new Cesium.ClippingPolygon({ positions: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)) })],
          inverse: true,
          enabled: false,
        });
      }

      // ---- seat the model on the map ----
      // Drone models use ellipsoid heights, so the street sits ~50–60 m above the flat
      // base map. heightOffset (metres) lowers the whole model at display time only.
      const modelSphere: C = tileset.boundingSphere.clone();
      if (config.heightOffset) {
        const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(modelSphere.center, new Cesium.Cartesian3());
        const shift = Cesium.Cartesian3.multiplyByScalar(up, config.heightOffset, new Cesium.Cartesian3());
        tileset.modelMatrix = Cesium.Matrix4.fromTranslation(shift);
        Cesium.Cartesian3.add(modelSphere.center, shift, modelSphere.center);
      }

      // ---- camera ----
      // A height safely above the model, used to drop probes onto the roof.
      const startH = Cesium.Cartographic.fromCartesian(modelSphere.center).height + modelSphere.radius;
      let buildingSphere: C = null;
      const c0 = ring ? centroid(ring) : null;
      // "Building only" camera target: the outline, a little below roof level.
      const setBuildingSphere = (roofH: number) => {
        if (!ring || !c0) return;
        const pts = ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, roofH));
        buildingSphere = Cesium.BoundingSphere.fromPoints(pts);
        buildingSphere.center = Cesium.Cartesian3.fromDegrees(c0[0], c0[1], roofH - 8);
        buildingSphere.radius += 5;
      };
      setBuildingSphere(Cesium.Cartographic.fromCartesian(modelSphere.center).height + modelSphere.radius * 0.3); // until sampled
      let buildingMode = false;
      const view = (sphere: C, dur: number) =>
        viewer.camera.flyToBoundingSphere(sphere, {
          offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-35), sphere.radius * 2.4),
          duration: dur,
        });
      const overview = (dur = 1.5) => view(buildingMode && buildingSphere ? buildingSphere : modelSphere, dur);

      // ---- basemap / plain background ----
      let basemapNow: Basemap = 'map';
      const css = (name: string, fallback: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const applyBackdrop = () => {
        const layers = viewer.imageryLayers;
        layers.removeAll();
        const plain = buildingMode;
        // The globe has to stay shown for clipping polygons to work, so in
        // "Building only" it becomes a plain floor in the page colour instead.
        if (!plain) layers.addImageryProvider(basemapNow === 'map' ? osm() : esri());
        const bg = Cesium.Color.fromCssColorString(css('--bg', '#f4f5f7'));
        scene.globe.baseColor = plain ? bg : Cesium.Color.fromCssColorString('#8a8f98');
        scene.backgroundColor = bg;
        scene.globe.showGroundAtmosphere = !plain;
        scene.skyAtmosphere.show = !plain;
        if (scene.skyBox) scene.skyBox.show = !plain;
        if (scene.sun) scene.sun.show = !plain;
        if (scene.moon) scene.moon.show = !plain;
        if (tileset.clippingPolygons) tileset.clippingPolygons.enabled = plain;
        scene.requestRender();
      };
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onScheme = () => applyBackdrop();
      mq.addEventListener('change', onScheme);
      cleanups.push(() => mq.removeEventListener('change', onScheme));

      // ---- findings pins ----
      const finds: Finding[] = config.findings ?? [];
      const pins = new Cesium.PinBuilder();
      const pinH = Cesium.Cartographic.fromCartesian(modelSphere.center).height + modelSphere.radius * 0.3;
      const ents = finds.map((f, i) =>
        viewer.entities.add({
          id: `finding-${i}`,
          position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, pinH),
          billboard: {
            image: pins.fromText(String(f.number), Cesium.Color.fromCssColorString(PRIORITY[f.priority]?.color ?? '#888'), 44).toDataURL(),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      const flyTo = (i: number) => {
        const p = ents[i]?.position?.getValue(Cesium.JulianDate.now());
        if (!p) return;
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(p, 6), {
          offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-45), 28),
          duration: 1.2,
        });
      };

      const click = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      click.setInputAction((ev: C) => {
        const hit = scene.pick(ev.position);
        const id: string | undefined = hit?.id?.id;
        if (id?.startsWith('finding-')) {
          const i = Number(id.slice(8));
          setActive((cur) => (cur === i ? null : i));
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      cleanups.push(() => click.destroy());

      api.current = {
        overview,
        flyTo,
        setBasemap: (b) => {
          basemapNow = b;
          applyBackdrop();
        },
        setBuildingOnly: (on) => {
          buildingMode = on;
          // Optional floor cut: hide stray ground/water geometry below the building.
          if (config.buildingFloor !== undefined && c0) {
            if (!tileset.clippingPlanes) {
              const floor = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(c0[0], c0[1], config.buildingFloor));
              // Plane matrices are relative to the tileset's clipping origin, so undo that first.
              const toLocal = Cesium.Matrix4.inverse(tileset.clippingPlanesOriginMatrix, new Cesium.Matrix4());
              tileset.clippingPlanes = new Cesium.ClippingPlaneCollection({
                modelMatrix: Cesium.Matrix4.multiply(toLocal, floor, new Cesium.Matrix4()),
                planes: [new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, 1), 0)], // keeps what is above the floor
                edgeWidth: 0,
              });
            }
            tileset.clippingPlanes.enabled = on;
          }
          applyBackdrop();
          overview(1.2);
        },
        screenshot: () => {
          scene.render();
          const a = document.createElement('a');
          a.href = scene.canvas.toDataURL('image/png');
          a.download = `${slug(config.site.name)}-3d-${new Date().toISOString().slice(0, 10)}.png`;
          a.click();
        },
      };

      applyBackdrop();
      overview(0);
      setStatus('');

      // Drop probes onto the model once the detailed tiles are in: the pins (snapped
      // onto the roof) and the outline (to find the roof height for "Building only").
      const ringProbes = ring ? [...ring, c0!] : [];
      const probes = [...finds.map((f) => [f.lon, f.lat]), ...ringProbes].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, startH));
      if (probes.length) {
        try {
          const hit: (C | undefined)[] = await scene.clampToHeightMostDetailed(probes);
          if (dead) return;
          const heights = hit.map((p) => (p ? Cesium.Cartographic.fromCartesian(p).height : NaN));
          const sorted = (hs: number[]) => hs.filter((h) => Number.isFinite(h)).sort((x, y) => x - y);

          const roof = sorted(heights.slice(finds.length));
          if (roof.length) setBuildingSphere(roof[Math.floor(roof.length * 0.75)]);

          const ok = sorted(heights.slice(0, finds.length));
          const median = ok.length ? ok[Math.floor(ok.length / 2)] : NaN;
          finds.forEach((f, i) => {
            // missed the roof (no hit, or landed on stray ground/water geometry) -> median of the others
            const h = Math.abs(heights[i] - median) <= 15 ? heights[i] : median;
            if (Number.isFinite(h)) ents[i].position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h + 0.3);
          });
          scene.requestRender();
        } catch (e) {
          console.warn('Could not sample the roof height', e);
        }
      }
    })().catch((e) => {
      console.error(e);
      if (!dead) {
        setFailed(true);
        setStatus('The 3D model could not be loaded. Please refresh the page.');
      }
    });

    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);

    return () => {
      dead = true;
      api.current = null;
      document.removeEventListener('fullscreenchange', onFs);
      cleanups.forEach((f) => f());
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  useEffect(() => {
    if (!api.current) return;
    if (active === null) api.current.overview(1.2);
    else api.current.flyTo(active);
  }, [active]);

  const findings = cfg?.findings ?? [];
  const canFull = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  const meta = cfg ? [cfg.site.address, cfg.site.surveyDate && `Surveyed ${fmtDate(cfg.site.surveyDate)}`, cfg.site.client && `For ${cfg.site.client}`].filter(Boolean) : [];

  return (
    <div className="app">
      <div className="viewer" ref={host} />

      <header className="bar">
        <div className="brand">
          <span className="eyebrow">{cfg?.company ?? 'DroneAsAService'} · 3D roof model</span>
          <h1>{cfg?.site.name ?? ' '}</h1>
          {meta.length > 0 && <p className="meta">{meta.join(' · ')}</p>}
        </div>
      </header>

      <div className="tools" role="toolbar" aria-label="View options">
        <div className="seg" role="group" aria-label="Base map">
          <button aria-pressed={basemap === 'map'} disabled={buildingOnly} onClick={() => { setBasemap('map'); api.current?.setBasemap('map'); }}>Map</button>
          <button aria-pressed={basemap === 'satellite'} disabled={buildingOnly} onClick={() => { setBasemap('satellite'); api.current?.setBasemap('satellite'); }}>Satellite</button>
        </div>
        {cfg?.outline?.length ? (
          <button className="tbtn" aria-pressed={buildingOnly} onClick={() => { const v = !buildingOnly; setBuildingOnly(v); setActive(null); api.current?.setBuildingOnly(v); }}>
            <Icon d="M4 21V9l8-6 8 6v12M9 21v-6h6v6" /> <span>Building only</span>
          </button>
        ) : null}
        <button className="tbtn icon" title="Reset view" aria-label="Reset view" onClick={() => { setActive(null); api.current?.overview(); }}>
          <Icon d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        </button>
        <button className="tbtn icon" title="Save a screenshot (PNG)" aria-label="Save a screenshot" onClick={() => api.current?.screenshot()}>
          <Icon d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
        </button>
        {canFull && (
          <button className="tbtn icon" title={isFull ? 'Exit full screen' : 'Full screen'} aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
            <Icon d={isFull ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </button>
        )}
      </div>

      {findings.length > 0 && (
        <aside className={`list ${listOpen ? '' : 'is-closed'}`} aria-label="Findings">
          <button className="list__head" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}>
            <b>Findings</b> <span className="count">{findings.length}</span>
            <span className="chev">{listOpen ? '−' : '+'}</span>
          </button>
          {listOpen && (
            <ol>
              {findings.map((f, i) => (
                <li key={i}>
                  <button className={active === i ? 'is-active' : ''} onClick={() => setActive(active === i ? null : i)}>
                    <span className="num" style={{ background: PRIORITY[f.priority]?.color }}>{f.number}</span>
                    <span className="ttl">
                      {f.title}
                      <small>{PRIORITY[f.priority]?.label ?? f.priority} priority</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}

      <p className="hint">
        <span className="desktop">Drag to rotate · right-drag or scroll to zoom · Ctrl-drag to tilt</span>
        <span className="touch">Drag to rotate · pinch to zoom · two-finger drag to tilt</span>
      </p>

      {status && (
        <div className="status" role="status">
          {!failed && <span className="spinner" />} {status}
        </div>
      )}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return isNaN(+d) ? iso : d.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
}

function centroid(ring: [number, number][]): [number, number] {
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

/** Push a lon/lat ring outwards by `d` metres (mitred corners, capped). */
function grow(ring: [number, number][], d: number): [number, number][] {
  if (!d) return ring;
  const [lon0, lat0] = centroid(ring);
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const pts = ring.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const s = area > 0 ? 1 : -1;
  const norm = ([x, y]: number[]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const n1 = norm([(p[1] - a[1]) * s, -(p[0] - a[0]) * s]);
    const n2 = norm([(b[1] - p[1]) * s, -(b[0] - p[0]) * s]);
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const k = Math.min(3, 1 / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]));
    return [lon0 + (p[0] + m[0] * d * k) / kx, lat0 + (p[1] + m[1] * d * k) / ky] as [number, number];
  });
}
