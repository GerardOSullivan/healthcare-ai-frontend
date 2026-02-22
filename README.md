# 🏥 Palliative Care AI — Netlify Dashboard

A production-grade deterioration prediction system for palliative care.
**React dashboard on Netlify · Python model running locally · Zero data leaves the hospital.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     NETLIFY (Public)                    │
│    React Dashboard  ←──── just HTML/CSS/JS, no data     │
└──────────────────────────┬──────────────────────────────┘
                           │ API calls (local network only)
                           ▼
┌─────────────────────────────────────────────────────────┐
│              HOSPITAL MACHINE (On-premise)              │
│                                                         │
│   app.py (Flask)                                        │
│   ├── /api/predict/single   ← nurse enters one patient  │
│   ├── /api/predict/batch    ← upload Excel file         │
│   └── /api/alerts/current   ← live dashboard feed       │
│                                                         │
│   model/trained_model.pkl   ← the AI (no patient data)  │
│   outputs/predictions_*.xlsx                            │
└─────────────────────────────────────────────────────────┘
```

**GDPR:** Patient data is only ever processed on the hospital machine.
The Netlify URL serves the visual interface only — like a website that
connects to a local database. No data transits through Netlify's servers.

---

## Quick Setup

### Step 1 — Hospital Machine (Python)

```bash
# Install dependencies
pip install scikit-learn pandas numpy matplotlib seaborn openpyxl flask flask-cors

# Train the model (first time, or with real data)
python train_model.py
python train_model.py --data your_patient_data.xlsx   # with real data

# Start the server (accessible on hospital local network)
python app.py --host 0.0.0.0 --port 5000
```

The terminal will print the machine's local IP, e.g. `http://192.168.1.50:5000`

### Step 2 — Deploy to Netlify

**Option A — Netlify Drop (no account needed, 1 minute):**
1. Run `npm install && npm run build` in this folder
2. Drag the `dist/` folder to https://app.netlify.com/drop
3. Done — you get a URL like `https://amazing-name-123.netlify.app`

**Option B — Netlify CLI:**
```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

**Option C — GitHub + Netlify (auto-deploys on push):**
1. Push this repo to GitHub
2. Connect the repo in Netlify dashboard
3. Set build command: `npm run build`
4. Set publish directory: `dist`

### Step 3 — Connect Dashboard to Local Server

1. Open the Netlify URL in a browser **on the hospital network**
2. Click **⚙ SERVER** (top right)
3. Enter: `http://192.168.1.50:5000` (your hospital machine's IP)
4. Click **TEST** to verify connection
5. Click **Save & Reload**

The server address is saved in the browser's local storage — nurses only need to do this once per device.

---

## Files

```
palliative-care-dashboard/
├── src/
│   ├── App.jsx           ← Full React dashboard (all 3 tabs)
│   └── main.jsx          ← React entry point
├── index.html            ← HTML shell
├── package.json          ← Node dependencies
├── vite.config.js        ← Build config
├── app.py                ← Flask server (runs on hospital machine)
├── predict.py            ← Prediction logic (batch + single)
├── train_model.py        ← Model training script
└── README.md
```

---

## Dashboard Features

### Tab 1 — Single Patient
- Enter vitals manually via a clean form
- Preset buttons: Stable / Medium / Urgent (for demos and testing)
- Instant risk score with animated gauge
- NEWS2 score calculated alongside the ML score
- Four alert levels: LOW / ELEVATED / HIGH RISK / URGENT

### Tab 2 — Batch Predict
- Drag-and-drop Excel or CSV upload
- Adjustable alert threshold slider
- Summary cards showing count per risk level
- Sortable table of all high-risk patients
- Results auto-saved to `outputs/` on the server

### Tab 3 — Live Dashboard
- Pulls the most recent batch prediction results
- Filterable by risk level (ALL / LOW / MEDIUM / HIGH / URGENT)
- Auto-refresh toggle (every 60 seconds)
- Urgent alert banner when any URGENT patients are present
- Patient cards with mini risk gauge + key vitals

---

## How to Use in Practice

### Cron job (hourly batch scoring)

On the hospital machine, add to crontab (`crontab -e`):

```bash
# Every hour: export data from hospital system, run predictions
0 * * * * cd /path/to/palliative-care-dashboard && python predict.py --data /exports/live_patients.xlsx
```

The Live Dashboard tab will automatically show the updated results.

### Nurse workflow

1. **Start of shift:** Open Netlify URL → check **Live Dashboard** tab for any high-risk flags
2. **During shift:** Use **Single Patient** tab to instantly check a patient after taking readings
3. **Batch review:** Charge nurse uploads the ward's patient list each morning via **Batch Predict**

---

## Data Format

Your Excel/CSV should have these columns:

| Column | Type | Example |
|--------|------|---------|
| `patient_id` | text/number | PAL-1042 |
| `age` | number | 74 |
| `heart_rate` | number | 82 |
| `systolic_bp` | number | 118 |
| `oxygen_saturation` | number | 95.5 |
| `temperature_c` | number | 37.2 |
| `respiratory_rate` | number | 18 |
| `pain_score` | number 0–10 | 4 |
| `consciousness_level` | text | Alert / Confused / Drowsy / Unresponsive |
| `mobility_score` | 1/2/3 | 2 |
| `hour_of_day` | 0–23 | 14 |
| `days_in_hospital` | number | 8 |
| `prior_episodes` | number | 1 |
| `medications_count` | number | 6 |
| `days_since_last_episode` | number | 12 |
| `deteriorated_within_24h` | 0 or 1 | 1 | ← Training only, omit for predictions |

---

## Troubleshooting

**"Cannot reach server" in the dashboard**
→ Ensure `python app.py --host 0.0.0.0` is running on the hospital machine
→ Check firewall allows port 5000
→ Confirm you're on the same network as the hospital machine
→ Try the IP address directly in browser: `http://192.168.1.50:5000/api/status`

**CORS errors in browser console**
→ Already handled — the server sends `Access-Control-Allow-Origin: *`
→ If restricting, edit `app.py` line with `CORS(app, origins=...)`

**Model not found**
→ Run `python train_model.py` on the hospital machine first

**Netlify build fails**
→ Ensure Node.js ≥ 18 is installed: `node --version`
→ Run `npm install` before `npm run build`

---

## Retrain the Model

```bash
# With updated patient data (recommended monthly)
python train_model.py --data data/updated_patients.xlsx

# Restart the server after retraining
python app.py --host 0.0.0.0
```

Model retraining replaces `model/trained_model.pkl`. The dashboard will show
the new AUC score automatically after the server restarts.
