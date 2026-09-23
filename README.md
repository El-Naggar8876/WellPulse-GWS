# WellPulse · GWS-SENCE

**Farmer app:** <https://wellpulse-gws.vercel.app/> · **Enrolment cards:** <https://wellpulse-gws.vercel.app/admin/enroll.html> · **Researcher dashboard (WellPulse Atlas):** <https://wellpulse-gws.vercel.app/dashboard/> (needs the viewer key) · Backend: Apps Script → Google Sheet *WellPulse GWS Readings* (deployed 22 Sep 2026).

Offline-first mobile app for farmers in the GWS-SENCE project to log groundwater **EC (salinity)** and **temperature** from a handheld meter, then send the readings to a shared Google Sheet whenever the phone has internet.

- **Installs from a QR card** – no app store. Scan, tap Install, done.
- **Works fully offline** – readings are saved on the phone with date, time and timezone.
- **One-tap sync** – "Send now" button plus automatic sending when the phone comes online. Duplicate-safe.
- **Arabic by default, English available** – full right-to-left layout, Arabic-Indic digits accepted.
- **Optional GPS and meter photo** – farmer can skip both.
- **Live validation** – hard limits block impossible values, soft limits ask for confirmation, and a big jump from the previous reading asks "are you sure?". The limits are editable in the Sheet.
- **Researchers see everything in a Google Sheet**, with optional nightly CSV/GeoJSON export to a Cloud Storage bucket for Earth Engine.
- **WellPulse Atlas** – a bilingual researcher/policy dashboard (`app/dashboard/`): satellite map of wells coloured by FAO salinity class, KPIs, trend/class/monthly/scatter charts, per-well drill-down with sparkline, filters, CSV export, printable report, light/dark. Protected by a viewer key; reads the sheet live through the Apps Script `data` endpoint.

```
app/        the PWA (hosted on Vercel; root directory of the deployment)
  admin/    enroll.html – prints QR enrolment cards
  dashboard/ WellPulse Atlas researcher dashboard
backend/    Google Apps Script (Code.gs) + deployment guide
tools/      mock-server.js (local test backend), e2e-check.js, make_icons.py
tests/      unit tests (node tests/run-tests.js)
```

## Try it locally (2 minutes)

```bash
npm start
```

Then open the link printed in the terminal (it enrols a demo farmer). The fake "sheet" is at <http://localhost:8080/__mock/>.
Tip: in Chrome DevTools, toggle the device toolbar to a phone size, and use the Network panel's "Offline" to test offline saving.

Run the tests:

```bash
npm test
```

```bash
node tools/e2e-check.js
```

The e2e script drives a headless Chrome/Edge through enrolment, saving, offline reload and auto-sync.

## Deploy for real (all free)

### 1. Backend – Google Sheet + Apps Script

Follow [backend/README.md](backend/README.md). You end up with a Web App URL ending in `/exec`.

### 2. App – hosting (Vercel)

The app is hosted on Vercel (project `wellpulse-gws`, root directory `app`, linked to this GitHub repository, so every push to `main` redeploys it automatically). GitHub Pages is not used (it would put the account name in the address). If you ever need it as a fallback:

1. Put the Web App URL in [app/js/config.js](app/js/config.js) as `API_URL`. Change `API_TOKEN` to something private and set the same value as `TOKEN` in `Code.gs`.
2. Push this repository to GitHub. In the repository settings choose **Pages → Deploy from a branch → `main` / `/ (root)`**.
3. The app will be at `https://<user>.github.io/<repo>/app/`. To get a shorter URL, publish only the `app/` folder or use a custom domain.

Every later `git push` updates the app on all phones automatically (the app shows an "Update" banner).

### 3. Enrol farmers

Open `https://<user>.github.io/<repo>/app/admin/enroll.html`, paste the farmer list (one per line: `ID, name, wells`), generate, print. Add the same farmers to the **Farmers** sheet so the server knows their names and wells (the app refreshes this whenever it is online).

Each card's QR opens a link like:

```
https://.../app/?f=F001&n=Ahmed&w=W1:North%20well,W2:South%20well&l=ar
```

The app stores the profile on first open and cleans the URL. The card also works as a plain link sent by WhatsApp.

### 4. Researcher views

- **WellPulse Atlas dashboard** – `https://wellpulse-gws.vercel.app/dashboard/?key=<VIEWER_KEY>`. The key is `VIEWER_KEY` in `Code.gs`; the "copy share link" button in the dashboard produces the full link. Map centre/zoom, salinity class thresholds and the project title are read from the **Config** tab (`map_center_lat`, `map_center_lon`, `map_zoom`, `class_1_max`, `class_2_max`, `project_name`), so the same dashboard works for any country.
- **Wells registry** – the **Wells** tab (`well_id, farmer_id, label, lat, lon, village, depth_m, notes, updated_at`). The app fills coordinates automatically from the first GPS-tagged reading of a well; researchers can add or correct rows by hand. To bulk-import a list, put the rows in `IMPORT_ROWS` in `Code.gs` and run `importWellsFromCode()` from the Apps Script editor.
- **Google Sheet** – share it with the research group (Viewer). The `Readings` tab is the raw log; add pivot tabs freely.
- **Looker Studio** (free) – *Create → Report → Google Sheets → Readings*. Add a map (lat/lon), a time series of `ec25_ms_cm` by `well_id`, and a farmer filter. Share the report link with the team.
- **Earth Engine** – after `installNightlyTrigger()` in Apps Script and a bucket name in `GCS_BUCKET`, the script writes `gs://<bucket>/wellpulse/readings.csv` and `readings.geojson` every night. Ingest with `earthengine upload table --asset_id=projects/<proj>/assets/gws_readings gs://<bucket>/wellpulse/readings.csv` (or from Colab/geemap), then `ee.FeatureCollection('projects/<proj>/assets/gws_readings')`.

## Data model (one row per reading)

| column | meaning |
|---|---|
| `id` | UUID generated on the phone; the server rejects duplicates |
| `farmer_id`, `farmer_name`, `well_id`, `well_label` | from the QR card / Farmers sheet |
| `ts_local`, `ts_epoch`, `tz` | phone time with offset, epoch ms, IANA timezone |
| `ec`, `ec_unit`, `ec_ms_cm` | as typed, the unit chosen, normalised to mS/cm |
| `temp_c` | water temperature |
| `ec25_ms_cm` | EC compensated to 25 °C (2 %/°C) unless `meter_compensated` is `yes` |
| `lat`, `lon`, `acc_m` | optional GPS |
| `photo_url` | optional Drive link to the meter photo |
| `note`, `app_version`, `device`, `lang`, `flag` | metadata; `flag` marks values outside the soft range |

## Adjusting the validation rules

When the groundwater expert gives the exact thresholds, edit the **Config** sheet (`ec_hard_max`, `ec_soft_max`, …). Phones pick the new limits up the next time they are online. The defaults live in `app/js/config.js` and `backend/Code.gs`. If the meter reports EC already compensated to 25 °C, set `METER_COMPENSATED: true` in `config.js`.

## Notes

- iPhone support exists (Add to Home Screen) but the project targets Android.
- The API token is a light gate against random traffic, not a secret: it ships in the app. Keep the Sheet itself private and share only with the project.
- Photos are compressed to ≈1024 px JPEG on the phone before upload.
