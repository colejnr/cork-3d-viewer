# Cork 3D Viewer

A client-facing 3D model viewer for a DroneAsAService roof inspection: one full-screen page
showing the drone's 3D Tiles model on a street or satellite map, with optional numbered
findings pinned on the roof.

- **Stack:** Vite + React + TypeScript. CesiumJS 1.121.0 comes from the jsDelivr CDN, not the bundle.
- **No accounts:** no Cesium ion token. The base maps are OpenStreetMap and Esri World Imagery.
- **Hosting:** Cloudflare Pages (free plan), project `cork-albert-quay-3d`.
- **The model is never committed.** `public/model/` is git-ignored. It is copied in locally
  and uploaded straight to Cloudflare when you deploy.

## Quick start

```bash
npm install
npm run model     # copy the DJI Terra export into public/model/
npm run dev       # http://localhost:5173
```

| Script            | What it does                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `npm run model`   | Copies the 3D Tiles export into `public/model/` and sets each tileset's `asset.version` to `1.0`. |
| `npm run build`   | Builds into `dist/` and checks the output against Cloudflare Pages' free limits.               |
| `npm run deploy`  | Builds, then uploads `dist/` with `wrangler pages deploy`.                                      |
| `npm run preview` | Serves the built `dist/` locally.                                                               |

## The viewer

- **Map / Satellite:** switches the base map between OpenStreetMap and Esri World Imagery.
- **Building only** (the default view for this job): hides everything outside the client's
  building outline and shows the building on a plain background. It uses an inverse `ClippingPolygonCollection`, plus an optional
  floor plane (`buildingFloor`).
- **Findings:** numbered pins coloured by priority, snapped onto the roof. Click a finding
  in the list to fly to it, and click it again to return to the overview.
- **Other controls:** reset view, PNG screenshot and full screen. The page follows the
  system's light or dark mode and works on phones.

## Adding a new job's model

1. **Copy the model** from the DJI Terra 3D Tiles folder (the one that contains
   `tileset.json` and the `Block*` folders):

   ```bash
   npm run model -- "E:/Jobs/NewSite/models/pc/0/terra_b3dms"
   ```

   This replaces `public/model/`. Geometry, transforms, `gltfUpAxis` and every level of
   detail are copied unchanged. Only `asset.version` is changed (`0.0` → `1.0`).

2. **Edit `public/config.json`:**

   ```jsonc
   {
     "company": "DroneAsAService",
     "site": { "name": "…", "address": "…", "surveyDate": "2026-11-02", "client": "" },
     "model": "model/tileset.json",
     "heightOffset": -59,        // metres; lowers the model so its street meets the map (see below)
     "outlinePadding": 1.5,      // metres added around the outline so the eaves aren't cut
     "buildingFloor": 0,         // optional: in "Building only", hide anything below this height
     "buildingOnlyAtStart": true, // open on the building alone; false = open on the map
     "outline": [[lon, lat], …], // building footprint (WGS84), used by "Building only"
     "findings": [
       { "number": 1, "title": "Ponding by the east outlet", "priority": "high", "lon": -8.4634, "lat": 51.8978 }
     ]
   }
   ```

   - `priority` is `high`, `medium` or `low`. If you leave `findings` empty, the list is hidden.
   - Leave out `outline` to hide the **Building only** button.
   - **Building footprint:** the easiest source is OpenStreetMap. On openstreetmap.org, click
     the building, then use the way ID with Overpass Turbo (`way(<id>); out geom;`) to copy
     its lon/lat points. Cork uses way 314936108 (One Albert Quay).
   - Leave `client` empty to keep it out of the header.
   - **`heightOffset`:** DJI models use ellipsoid heights, which puts the model's street
     level about 50–60 m above the flat base map in Ireland. Start at about `-58` and adjust in
     steps of a few metres until the model's roads line up with the map's roads when you tilt
     the view. Remove the setting to show the raw heights. This only moves the model on
     screen; the files stay unchanged.
   - To find lon/lat for findings or outline points, right-click in Google Maps or use
     geojson.io.

3. **Check it locally** with `npm run dev`, then **deploy to its own Pages project** by
   changing `--project-name` in the `deploy` script (for example `newsite-3d`). Each job
   then gets its own `*.pages.dev` address. Create the new project once first:

   ```bash
   npx wrangler pages project create newsite-3d --production-branch main --force
   ```

   `--force` is needed only for this create step. Without it, recent versions of wrangler
   try to create the project on Cloudflare Workers instead of Pages, and the create fails.
   Once the project exists, `npm run deploy` works as normal.

## Redeploying

You only need to log in to Cloudflare once per computer:

```bash
npx wrangler login     # opens the browser; sign in there
```

After that, each deploy is one command:

```bash
npm run deploy
```

The site address is `https://cork-albert-quay-3d.pages.dev`. Each deploy also gets its own
preview URL. Cloudflare's free plan allows 20,000 files and 25 MiB per file;
`npm run build` checks both and stops before uploading if either limit is exceeded. This
model has about 3,350 files and its largest file is about 0.5 MiB.

If you change only `config.json`, such as adding findings, you still have to redeploy. The
upload is fast because Cloudflare skips files it already has.

## Moving the model to Cloudflare R2 later

You might move the model to R2 to keep Pages deploys small, to share one model across
several viewers, or if a future model goes over the Pages limits. The model would then live
in an R2 bucket and the Pages site would hold only the page.

1. **Create a bucket** in the Cloudflare dashboard (R2 → Create bucket), for example
   `drone-models`. R2's free tier covers 10 GB of storage and has no egress fees.
2. **Upload the model** under a folder per job. For thousands of files, use `rclone` with
   R2's S3 credentials (R2 → Manage API tokens):

   ```bash
   rclone copy public/model r2:drone-models/cork-albert-quay --transfers 32 --progress
   ```

   (`npx wrangler r2 object put` uploads only one file at a time.)
3. **Make it public:** in the bucket's Settings, either connect a custom domain
   (recommended, e.g. `models.example.com`) or enable the `r2.dev` public URL.
4. **Add CORS** in the bucket's Settings so the viewer can fetch the tiles:

   ```json
   [{ "AllowedOrigins": ["https://cork-albert-quay-3d.pages.dev"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"] }]
   ```

5. **Point the viewer at it** in `config.json`:

   ```json
   "model": "https://models.example.com/cork-albert-quay/tileset.json"
   ```

6. **Stop shipping the model with Pages:** delete `public/model/` (or don't run
   `npm run model`) and redeploy. The build check warns that there is no local model,
   which is expected at that point.

## Project layout

```
public/config.json        site details, outline, findings (edit per job)
public/_headers           Cloudflare caching/CORS headers for the model
public/model/             the 3D Tiles model (git-ignored, filled by `npm run model`)
scripts/copy-model.mjs    copies + version-fixes a DJI Terra export
scripts/check-dist.mjs    Cloudflare Pages limit check, run after every build
src/App.tsx               the viewer
```
