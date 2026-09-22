# WellPulse GWS – backend (Google Sheet + Apps Script)

Everything here is free and lives in your Google account.

> **Status (22 Sep 2026): deployed.** Standalone Apps Script project **"WellPulse GWS Backend"** (in Drive) writes to the sheet
> **WellPulse GWS Readings** (`SHEET_ID` is set in `Code.gs`). Web App URL is in `app/js/config.js`.
> To update the code later: open the project from https://script.google.com/home, paste the new `Code.gs`,
> then **Deploy → Manage deployments → ✎ → Version: New version → Deploy** (the URL does not change).

## 1. Create the Sheet and script (10 minutes)

1. Create a new Google Sheet, name it **WellPulse GWS Readings**.
2. Menu **Extensions → Apps Script**. Delete the default code.
3. Paste the whole of `Code.gs` into the editor.
4. In the left bar click the gear **Project Settings** → tick **Show "appsscript.json" manifest file**. Open `appsscript.json` in the editor and replace its content with the `appsscript.json` from this folder (this sets the OAuth scopes and time zone; change `timeZone` if needed).
5. Change `TOKEN` at the top of `Code.gs` to a private value (the same value goes into `app/js/config.js` as `API_TOKEN`).
6. Select the function **`setup`** in the toolbar and click **Run**. Approve the permissions (Sheets, Drive, external requests). This creates the tabs **Readings**, **Farmers**, **Config**, **Log** and a Drive folder **WellPulse Photos**.

## 2. Deploy as a Web App

1. **Deploy → New deployment → type: Web app**.
2. Description: `WellPulse v1`. **Execute as: Me**. **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
4. Paste it into `app/js/config.js` → `API_URL`.

Test in a browser: `https://script.google.com/macros/s/…/exec?action=ping&token=YOUR_TOKEN` should return `{"ok":true,...}`.

**Updating the script later:** edit the code, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same.

## 3. Register farmers

In the **Farmers** tab add one row per farmer:

| farmer_id | name | wells (id:label, id:label) | lang |
|---|---|---|---|
| F001 | أحمد محمد | W1:البئر الشمالي, W2:البئر الجنوبي | ar |

The app fetches this when online, so you can rename wells or add wells centrally.

## 4. Validation limits

Edit values in the **Config** tab. `hard` limits reject the reading (both in the app and on the server); `soft` limits only ask the farmer to confirm and mark the row with a `flag`.

## 5. Nightly export to your Cloud Storage bucket (optional, for Earth Engine)

1. Set `GCS_BUCKET = 'your-bucket-name'` in `Code.gs` (the script runs as you, so your account needs write access to the bucket).
2. Run **`exportToBucket`** once to test, then run **`installNightlyTrigger`**. Check the **Log** tab.
3. Files: `gs://your-bucket/wellpulse/readings.csv` and `readings.geojson`.

Ingest into Earth Engine when needed:

```bash
earthengine upload table --asset_id=projects/YOUR_PROJECT/assets/gws_readings gs://your-bucket/wellpulse/readings.csv
```

## Quotas

Apps Script free quotas are far above this project's needs (thousands of requests per day). The Sheet handles hundreds of thousands of rows. Photos live in Drive (15 GB free), each ≈50–150 KB.

## Endpoint contract

`POST` body (`text/plain` to avoid CORS preflight):

```json
{ "action": "submit", "token": "…", "records": [ { "id": "uuid", "farmer_id": "F001", "well_id": "W1", "ts_local": "2026-09-22T14:05:09+02:00", "ts_epoch": 1790000000000, "tz": "Africa/Cairo", "ec": 1.8, "ec_unit": "mS/cm", "ec_ms": 1.8, "temp_c": 24.5, "lat": 29.1, "lon": 31.1, "acc_m": 8, "note": "", "photo": "data:image/jpeg;base64,…" } ] }
```

Response: `{ "ok": true, "results": [ { "id": "uuid", "ok": true, "status": "inserted" | "duplicate" | "rejected", "reason": "…", "photo_url": "…" } ] }`

`GET ?action=config&token=…&f=F001` → `{ ok, limits, farmer }`.
