import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════
   CONFIGURATION
═══════════════════════════════════════════════════════════════════ */
const API_BASE =
  (typeof window !== "undefined" && localStorage.getItem("api_base")) ||
  "https://healthcare-ai-backend-qcr3.onrender.com";

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T & { __error?: string }> {
  const base = localStorage.getItem("api_base") || API_BASE;
  try {
    const r = await fetch(base + "/api" + path, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    return { __error: (e as Error).message || "Server unreachable" } as T & { __error: string };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════ */
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | "NONE";
type ConsciousnessLevel = "Alert" | "Confused" | "Drowsy" | "Unresponsive";
type FilterLevel = "ALL" | RiskLevel;
type SortBy = "risk" | "id";

interface RiskStyle {
  fill: string;
  stroke: string;
  glow: string;
  label: string;
  icon: string;
}

interface PatientForm {
  age: number;
  heart_rate: number;
  systolic_bp: number;
  oxygen_saturation: number;
  temperature_c: number;
  respiratory_rate: number;
  pain_score: number;
  consciousness_level: ConsciousnessLevel;
  mobility_score: number;
  hour_of_day: number;
  days_in_hospital: number;
  prior_episodes: number;
  medications_count: number;
  days_since_last_episode: number;
}

interface PredictionResult {
  risk_score: number;
  alert_level: RiskLevel;
  news2_score: number;
  news2_risk: string;
  model_auc: string | number;
  predicted_at: string;
  action: string;
  __error?: string;
}

interface BatchResult {
  alert_breakdown: Partial<Record<RiskLevel, number>>;
  total_patients: number;
  high_risk_patients: PatientSummary[];
  __error?: string;
}

interface PatientSummary {
  patient_id?: string;
  risk_score: number;
  alert_level: RiskLevel;
  news2_score?: number;
  oxygen_saturation?: number;
  respiratory_rate?: number;
  action: string;
}

interface ModelStatus {
  status: "ready" | "not_ready";
  auc_roc?: number;
  trained_at?: string;
  patients?: PatientSummary[];
  __error?: string;
}

/* ═══════════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════════ */
const T = {
  bg:       "#060a12",
  surface:  "#0c1220",
  border:   "#1a2540",
  borderHi: "#243050",
  text:     "#c8d8f0",
  muted:    "#4a6080",
  LOW:    { fill: "#0d3320", stroke: "#1a6640", glow: "#00ff88", label: "LOW RISK",  icon: "◆" },
  MEDIUM: { fill: "#2d1f00", stroke: "#7a5200", glow: "#ffaa00", label: "ELEVATED",  icon: "▲" },
  HIGH:   { fill: "#2d0a0a", stroke: "#8b1a1a", glow: "#ff4444", label: "HIGH RISK", icon: "■" },
  URGENT: { fill: "#2d0020", stroke: "#8b0060", glow: "#ff00aa", label: "URGENT",    icon: "◉" },
  NONE:   { fill: "#0c1220", stroke: "#1a2540", glow: "#4a6080", label: "—",         icon: "○" },
} as const;

const risk = (lvl?: RiskLevel | string): RiskStyle =>
  (T as unknown as Record<string, RiskStyle>)[lvl ?? ""] ?? T.NONE;

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL STYLES
═══════════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #060a12;
    color: #c8d8f0;
    font-family: 'Syne', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #060a12; }
  ::-webkit-scrollbar-thumb { background: #1a2540; border-radius: 2px; }
  input, select, textarea {
    font-family: 'JetBrains Mono', monospace;
    background: #060a12;
    border: 1px solid #1a2540;
    color: #c8d8f0;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    width: 100%;
    transition: border-color 0.15s;
  }
  input:focus, select:focus { border-color: #3a6aff; box-shadow: 0 0 0 2px rgba(58,106,255,0.15); }
  input[type=range] { padding: 0; background: none; border: none; cursor: pointer; accent-color: #3a6aff; }
  button { font-family: 'Syne', sans-serif; cursor: pointer; border: none; outline: none; }
  select option { background: #0c1220; }

  @keyframes fadeUp   { from { opacity:0; transform:translateY(12px);} to { opacity:1; transform:none; } }
  @keyframes pulse    { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes scanline { 0% { transform:translateY(-100%); } 100% { transform:translateY(100vh); } }
  @keyframes glow     { 0%,100% { box-shadow: 0 0 8px currentColor; } 50% { box-shadow: 0 0 20px currentColor; } }
  @keyframes spin     { to { transform:rotate(360deg); } }
  @keyframes ripple   { 0% { transform:scale(1); opacity:0.6; } 100% { transform:scale(2.5); opacity:0; } }

  .fade-up  { animation: fadeUp 0.35s ease both; }
  .pulsing  { animation: pulse 2s ease-in-out infinite; }

  .tab-btn {
    background: none; border: none; color: #4a6080;
    font-size: 12px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 16px 20px;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    cursor: pointer;
  }
  .tab-btn:hover { color: #c8d8f0; }
  .tab-btn.active { color: #3a6aff; border-bottom-color: #3a6aff; }

  .field-label {
    font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
    color: #4a6080; margin-bottom: 5px; display: block;
  }
  .btn-primary {
    background: #1a3aff; color: #fff; border-radius: 4px;
    font-weight: 700; font-size: 13px; letter-spacing: 1.5px;
    text-transform: uppercase; padding: 12px 24px;
    transition: background 0.15s, transform 0.1s;
  }
  .btn-primary:hover:not(:disabled) { background: #2a4aff; transform: translateY(-1px); }
  .btn-primary:disabled { background: #1a2540; color: #4a6080; cursor: not-allowed; }

  .data-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid #0f1828;
    font-size: 13px;
  }
  .data-row:last-child { border-bottom: none; }
  .mono { font-family: 'JetBrains Mono', monospace; }
`;

/* ═══════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
═══════════════════════════════════════════════════════════════════ */

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

function Card({ children, style, className = "" }: CardProps) {
  return (
    <div className={className} style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "1.5rem",
      ...style
    }}>
      {children}
    </div>
  );
}

interface SectionLabelProps {
  children: React.ReactNode;
}

function SectionLabel({ children }: SectionLabelProps) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: 3, textTransform: "uppercase",
      color: T.muted, marginBottom: 12, marginTop: 4,
      display: "flex", alignItems: "center", gap: 8
    }}>
      <div style={{ flex: 1, height: 1, background: T.border }} />
      {children}
      <div style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  );
}

interface RiskOrbProps {
  score?: number | null;
  level?: RiskLevel | string;
  size?: number;
}

function RiskOrb({ score, level, size = 120 }: RiskOrbProps) {
  const r = risk(level);
  const pct = score != null ? Math.round(score * 100) : null;
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (circumference * (score || 0));

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {level && level !== "NONE" && (
        <div style={{
          position: "absolute", inset: "10%",
          borderRadius: "50%",
          background: r.glow,
          opacity: 0.08,
          filter: "blur(20px)",
          animation: "pulse 2s ease-in-out infinite"
        }} />
      )}
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none"
          stroke={T.border} strokeWidth="6" />
        {score != null && (
          <circle cx="50" cy="50" r="45" fill="none"
            stroke={r.glow} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1), stroke 0.4s" }}
            filter={`drop-shadow(0 0 6px ${r.glow})`}
          />
        )}
        <text x="50" y="46" textAnchor="middle"
          fontSize="18" fontWeight="700" fontFamily="'JetBrains Mono'"
          fill={r.glow}>
          {pct != null ? `${pct}` : "—"}
        </text>
        {pct != null && (
          <text x="50" y="58" textAnchor="middle"
            fontSize="9" fontFamily="'Syne'" fontWeight="600"
            fill={T.muted} letterSpacing="1">
            RISK %
          </text>
        )}
      </svg>
    </div>
  );
}

interface AlertChipProps {
  level?: RiskLevel | string;
}

function AlertChip({ level }: AlertChipProps) {
  const r = risk(level);
  if (!level) return null;
  return (
    <span style={{
      background: r.fill, border: `1px solid ${r.stroke}`,
      color: r.glow, borderRadius: 3, padding: "3px 10px",
      fontSize: 10, fontWeight: 700, letterSpacing: 2,
      textTransform: "uppercase", fontFamily: "Syne",
      boxShadow: `0 0 8px ${r.glow}22`
    }}>
      {r.icon} {r.label}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 16, height: 16, border: "2px solid #1a2540",
      borderTopColor: "#3a6aff", borderRadius: "50%",
      animation: "spin 0.7s linear infinite", display: "inline-block"
    }} />
  );
}

interface ErrorBoxProps {
  msg: string;
}

function ErrorBox({ msg }: ErrorBoxProps) {
  return (
    <div style={{
      background: "#1a0808", border: "1px solid #4a1515",
      borderRadius: 6, padding: "12px 16px",
      color: "#ff6666", fontSize: 13, marginTop: 12
    }}>
      ⚠ {msg}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FIELD COMPONENTS
═══════════════════════════════════════════════════════════════════ */
interface FieldProps {
  label: string;
  name: string;
  value: string | number;
  onChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  type?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: string;
}

function Field({ label, name, value, onChange, type = "number", options, min, max, step = "1" }: FieldProps) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {options ? (
        <select name={name} value={value} onChange={onChange as React.ChangeEventHandler<HTMLSelectElement>}>
          {options.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} name={name} value={value}
          min={min} max={max} step={step}
          onChange={onChange as React.ChangeEventHandler<HTMLInputElement>} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DEFAULT FORM + PRESETS
═══════════════════════════════════════════════════════════════════ */
const DEFAULT: PatientForm = {
  age: 72, heart_rate: 80, systolic_bp: 118, oxygen_saturation: 95.5,
  temperature_c: 37.2, respiratory_rate: 17, pain_score: 3.5,
  consciousness_level: "Alert", mobility_score: 2, hour_of_day: 14,
  days_in_hospital: 7, prior_episodes: 1, medications_count: 6,
  days_since_last_episode: 10,
};

const PRESETS: Record<string, PatientForm> = {
  stable: { ...DEFAULT, heart_rate: 68, oxygen_saturation: 98, respiratory_rate: 13, pain_score: 1, consciousness_level: "Alert", prior_episodes: 0, systolic_bp: 130 },
  medium: { ...DEFAULT, heart_rate: 92, oxygen_saturation: 93, respiratory_rate: 23, pain_score: 6, consciousness_level: "Confused", hour_of_day: 3, prior_episodes: 2, systolic_bp: 102 },
  urgent: { ...DEFAULT, age: 87, heart_rate: 118, oxygen_saturation: 86, respiratory_rate: 34, pain_score: 9, consciousness_level: "Drowsy", mobility_score: 3, hour_of_day: 2, days_in_hospital: 48, prior_episodes: 5, days_since_last_episode: 1, systolic_bp: 84, temperature_c: 39.1 },
};

/* ═══════════════════════════════════════════════════════════════════
   TAB 1 — SINGLE PATIENT
═══════════════════════════════════════════════════════════════════ */
function SinglePatient() {
  const [form, setForm] = useState<PatientForm>(DEFAULT);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (e) => {
    const { name, value, type } = e.target;
    setForm(f => ({ ...f, [name]: type === "number" ? parseFloat(value) || 0 : value }));
  };

  const predict = async () => {
    setLoading(true); setError(null);
    const payload: Record<string, number | string> = { ...form };
    (["age","heart_rate","systolic_bp","oxygen_saturation","temperature_c",
     "respiratory_rate","pain_score","mobility_score","hour_of_day",
     "days_in_hospital","prior_episodes","medications_count","days_since_last_episode"
    ] as const).forEach(k => { payload[k] = parseFloat(String(payload[k])); });

    const res = await api<PredictionResult>("/predict/single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (res.__error) setError(res.__error);
    else setResult(res);
  };

  const news2Color = !result ? T.muted :
    result.news2_score < 3 ? "#00ff88" :
    result.news2_score < 5 ? "#ffaa00" : "#ff4444";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>

      {/* ── Form ── */}
      <Card>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: T.muted, textTransform: "uppercase" }}>PRESET</span>
          {Object.keys(PRESETS).map(p => (
            <button key={p} onClick={() => { setForm(PRESETS[p]); setResult(null); }}
              style={{
                background: T.border, border: "none", color: T.muted,
                borderRadius: 3, padding: "4px 12px", fontSize: 10,
                fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", fontFamily: "Syne",
                transition: "color 0.15s, background 0.15s"
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.color = "#c8d8f0";
                (e.target as HTMLButtonElement).style.background = "#243050";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.color = T.muted;
                (e.target as HTMLButtonElement).style.background = T.border;
              }}
            >
              {p}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Age (years)" name="age" value={form.age} onChange={change} min={18} max={110} />
          <Field label="Consciousness" name="consciousness_level" value={form.consciousness_level}
            onChange={change} options={["Alert","Confused","Drowsy","Unresponsive"]} />
        </div>

        <SectionLabel>Vital Signs</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Heart Rate (bpm)" name="heart_rate" value={form.heart_rate} onChange={change} min={30} max={200} />
          <Field label="Systolic BP (mmHg)" name="systolic_bp" value={form.systolic_bp} onChange={change} min={50} max={250} />
          <Field label="O₂ Saturation (%)" name="oxygen_saturation" value={form.oxygen_saturation} onChange={change} min={50} max={100} step="0.1" />
          <Field label="Temperature (°C)" name="temperature_c" value={form.temperature_c} onChange={change} min={30} max={42} step="0.1" />
          <Field label="Respiratory Rate" name="respiratory_rate" value={form.respiratory_rate} onChange={change} min={4} max={60} />
          <Field label="Pain Score (0–10)" name="pain_score" value={form.pain_score} onChange={change} min={0} max={10} step="0.5" />
        </div>

        <SectionLabel>Clinical Context</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Mobility (1=mobile 3=bedbound)" name="mobility_score" value={form.mobility_score} onChange={change} min={1} max={3} />
          <Field label="Hour of Day (0–23)" name="hour_of_day" value={form.hour_of_day} onChange={change} min={0} max={23} />
          <Field label="Days in Hospital" name="days_in_hospital" value={form.days_in_hospital} onChange={change} min={0} max={365} />
          <Field label="Prior Episodes" name="prior_episodes" value={form.prior_episodes} onChange={change} min={0} max={30} />
          <Field label="Active Medications" name="medications_count" value={form.medications_count} onChange={change} min={0} max={40} />
          <Field label="Days Since Last Episode" name="days_since_last_episode" value={form.days_since_last_episode} onChange={change} min={0} max={365} />
        </div>

        <button className="btn-primary" onClick={predict} disabled={loading}
          style={{ marginTop: 20, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {loading ? <><Spinner /> ANALYSING…</> : "▶  RUN PREDICTION"}
        </button>
        {error && <ErrorBox msg={error} />}
      </Card>

      {/* ── Result panel ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: T.muted, textTransform: "uppercase", marginBottom: 16 }}>
            Deterioration Risk
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <RiskOrb score={result?.risk_score} level={result?.alert_level} size={130} />
          </div>
          {result ? (
            <>
              <AlertChip level={result.alert_level} />
              <div style={{ marginTop: 12, fontSize: 12, color: T.muted }}>
                {result.action}
              </div>
            </>
          ) : (
            <div style={{ color: T.muted, fontSize: 13 }}>Awaiting vitals input</div>
          )}
        </Card>

        {result && (
          <Card className="fade-up">
            <SectionLabel>Score Breakdown</SectionLabel>
            {([
              ["Risk Score",   `${(result.risk_score * 100).toFixed(1)}%`, "#3a6aff"],
              ["NEWS2 Score",  `${result.news2_score} · ${result.news2_risk}`, news2Color],
              ["Model AUC",    String(result.model_auc), T.muted],
              ["Assessed",     new Date(result.predicted_at).toLocaleTimeString(), T.muted],
            ] as [string, string, string][]).map(([k, v, c]) => (
              <div className="data-row" key={k}>
                <span style={{ color: T.muted, fontSize: 12 }}>{k}</span>
                <span className="mono" style={{ color: c, fontSize: 13, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </Card>
        )}

        <Card style={{ padding: "1rem 1.25rem" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: T.muted, textTransform: "uppercase", marginBottom: 8 }}>NEWS2 Reference</div>
          {([ ["0–2","Low","#00ff88"], ["3–4","Medium","#ffaa00"], ["5+","High — escalate","#ff4444"] ] as [string, string, string][]).map(([range, lbl, col]) => (
            <div key={range} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0" }}>
              <span className="mono" style={{ color: col }}>{range}</span>
              <span style={{ color: T.muted }}>{lbl}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 2 — BATCH UPLOAD
═══════════════════════════════════════════════════════════════════ */
function BatchPredict() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("threshold", String(threshold));
    const res = await api<BatchResult>("/predict/batch", { method: "POST", body: fd });
    setLoading(false);
    if (res.__error) setError(res.__error);
    else setResult(res);
  };

  const levels: RiskLevel[] = ["LOW","MEDIUM","HIGH","URGENT"];
  const breakdown = result?.alert_breakdown || {};

  return (
    <div style={{ maxWidth: 900 }}>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("batch-file-input")?.click()}
        style={{
          border: `2px dashed ${drag ? "#3a6aff" : T.border}`,
          borderRadius: 8, padding: "2.5rem",
          textAlign: "center", cursor: "pointer",
          background: drag ? "#0d1630" : T.surface,
          transition: "all 0.2s", marginBottom: 16
        }}
      >
        <input id="batch-file-input" type="file" accept=".xlsx,.csv"
          style={{ display: "none" }}
          onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
        <div style={{ fontWeight: 700, fontSize: 15, color: file ? "#3a6aff" : T.text }}>
          {file ? file.name : "Drop patient Excel or CSV file"}
        </div>
        <div style={{ color: T.muted, fontSize: 12, marginTop: 4 }}>
          {file ? `${(file.size / 1024).toFixed(1)} KB` : "or click to browse · .xlsx or .csv"}
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "end" }}>
          <div>
            <label className="field-label">Alert Threshold — flag patients above this risk score</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={0.2} max={0.8} step={0.05} value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                style={{ flex: 1, width: "auto" }} />
              <span className="mono" style={{ color: "#3a6aff", fontWeight: 700, minWidth: 40 }}>
                {Math.round(threshold * 100)}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginTop: 4 }}>
              <span>Sensitive (more alerts)</span>
              <span>Conservative (fewer alerts)</span>
            </div>
          </div>
          <button className="btn-primary" onClick={run} disabled={!file || loading}
            style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            {loading ? <><Spinner />RUNNING…</> : "▶ RUN BATCH"}
          </button>
        </div>
      </Card>

      {error && <ErrorBox msg={error} />}

      {result && (
        <div className="fade-up">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
            {levels.map(lvl => {
              const r = risk(lvl);
              const count = breakdown[lvl] || 0;
              const pct = result.total_patients ? (count / result.total_patients * 100).toFixed(0) : 0;
              return (
                <div key={lvl} style={{
                  background: r.fill, border: `1px solid ${r.stroke}`,
                  borderRadius: 8, padding: "1rem", textAlign: "center",
                  boxShadow: count > 0 ? `0 0 12px ${r.glow}18` : "none"
                }}>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: r.glow }}>{count}</div>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: r.glow, textTransform: "uppercase", opacity: 0.8 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{pct}%</div>
                </div>
              );
            })}
          </div>

          {result.high_risk_patients?.length > 0 && (
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#ff4444" }}>
                  High Risk / Urgent — {result.high_risk_patients.length} patients
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>Sorted by risk score</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["Patient ID","Risk","Level","NEWS2","Action"].map(h => (
                        <th key={h} style={{
                          textAlign: "left", padding: "8px 12px",
                          color: T.muted, borderBottom: `1px solid ${T.border}`,
                          fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.high_risk_patients]
                      .sort((a, b) => b.risk_score - a.risk_score)
                      .map((p, i) => {
                        const r = risk(p.alert_level);
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${T.bg}` }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#0d1628")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <td className="mono" style={{ padding: "10px 12px", color: T.text }}>{p.patient_id ?? "—"}</td>
                            <td className="mono" style={{ padding: "10px 12px", color: r.glow, fontWeight: 700 }}>
                              {(p.risk_score * 100).toFixed(1)}%
                            </td>
                            <td style={{ padding: "10px 12px" }}><AlertChip level={p.alert_level} /></td>
                            <td className="mono" style={{ padding: "10px 12px", color: T.muted }}>{p.news2_score ?? "—"}</td>
                            <td style={{ padding: "10px 12px", color: T.muted, fontSize: 11 }}>{p.action}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 3 — LIVE DASHBOARD
═══════════════════════════════════════════════════════════════════ */
function LiveDashboard() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState<FilterLevel>("ALL");
  const [sortBy] = useState<SortBy>("risk");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const res = await api<{ patients?: PatientSummary[] }>("/alerts/current");
    setLoading(false);
    if (!res.__error && res.patients) {
      setPatients(res.patients);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchAlerts, 60000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchAlerts]);

  const filtered = patients
    .filter(p => filter === "ALL" || p.alert_level === filter)
    .sort((a, b) =>
      sortBy === "risk"
        ? b.risk_score - a.risk_score
        : (a.patient_id ?? "").localeCompare(b.patient_id ?? "")
    );

  const counts: Record<FilterLevel, number> = { ALL: patients.length, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0, NONE: 0 };
  (["LOW","MEDIUM","HIGH","URGENT"] as RiskLevel[]).forEach(l => {
    counts[l] = patients.filter(p => p.alert_level === l).length;
  });

  const urgentCount = (counts.HIGH || 0) + (counts.URGENT || 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["ALL","LOW","MEDIUM","HIGH","URGENT"] as FilterLevel[]).map(f => {
            const r = f === "ALL"
              ? { glow: T.text, fill: T.surface, stroke: T.border }
              : risk(f);
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  background: active ? r.fill : "transparent",
                  border: `1px solid ${active ? r.stroke : T.border}`,
                  color: active ? r.glow : T.muted,
                  borderRadius: 4, padding: "6px 14px",
                  fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
                  textTransform: "uppercase", fontFamily: "Syne",
                  cursor: "pointer", transition: "all 0.15s",
                  boxShadow: active && f !== "ALL" ? `0 0 10px ${r.glow}18` : "none"
                }}>
                {f} <span style={{ opacity: 0.7 }}>({counts[f]})</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={fetchAlerts} disabled={loading}
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              color: loading ? T.muted : "#3a6aff", borderRadius: 4,
              padding: "6px 14px", fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "Syne", display: "flex", alignItems: "center", gap: 6
            }}>
            {loading ? <Spinner /> : "↻"} REFRESH
          </button>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            fontSize: 11, color: autoRefresh ? "#3a6aff" : T.muted, fontWeight: 700, letterSpacing: 1 }}>
            <div style={{
              width: 28, height: 16, borderRadius: 8,
              background: autoRefresh ? "#1a3aff" : T.border,
              position: "relative", transition: "background 0.2s", cursor: "pointer"
            }} onClick={() => setAutoRefresh(v => !v)}>
              <div style={{
                width: 12, height: 12, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 2,
                left: autoRefresh ? 14 : 2, transition: "left 0.2s"
              }} />
            </div>
            AUTO (1min)
          </label>
        </div>
      </div>

      {urgentCount > 0 && (
        <div style={{
          background: "#2d0a0a", border: "1px solid #8b1a1a",
          borderRadius: 6, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
          animation: "pulse 2s ease-in-out infinite"
        }}>
          <span style={{ fontSize: 20 }}>🔴</span>
          <span style={{ color: "#ff4444", fontWeight: 700, fontSize: 14 }}>
            {urgentCount} patient{urgentCount !== 1 ? "s" : ""} require immediate clinical review
          </span>
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            {lastRefresh ? `Last updated ${lastRefresh.toLocaleTimeString()}` : ""}
          </span>
        </div>
      )}

      {patients.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ color: T.muted, fontSize: 14 }}>
            No patient data yet.<br />
            Run a batch prediction first — the dashboard will show those results here.
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: T.muted, fontFamily: "JetBrains Mono" }}>
            python predict.py --data patients.xlsx
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ color: T.muted }}>No patients match this filter.</div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filtered.map((p, i) => {
            const r = risk(p.alert_level);
            return (
              <div key={i} className="fade-up" style={{
                animationDelay: `${i * 0.03}s`,
                background: r.fill, border: `1px solid ${r.stroke}`,
                borderRadius: 8, padding: "1.25rem",
                boxShadow: p.alert_level === "URGENT" ? `0 0 16px ${r.glow}25` : "none",
                transition: "transform 0.15s", cursor: "default"
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "none")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Patient</div>
                    <div className="mono" style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>
                      {p.patient_id ?? "—"}
                    </div>
                  </div>
                  <AlertChip level={p.alert_level} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <RiskOrb score={p.risk_score} level={p.alert_level} size={70} />
                  <div style={{ flex: 1 }}>
                    {([
                      ["NEWS2",     p.news2_score ?? "—"],
                      ["O₂ Sat",   p.oxygen_saturation != null ? `${p.oxygen_saturation}%` : "—"],
                      ["Resp Rate", p.respiratory_rate ?? "—"],
                    ] as [string, string | number][]).map(([k, v]) => (
                      <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                        <span style={{ color: T.muted }}>{k}</span>
                        <span className="mono" style={{ color: T.text }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  fontSize: 11, color: r.glow, background: `${r.glow}12`,
                  border: `1px solid ${r.stroke}`, borderRadius: 4, padding: "6px 10px"
                }}>
                  {p.action}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════════ */
interface SettingsModalProps {
  onClose: () => void;
}

interface ConnectionStatus {
  ok: boolean;
  auc?: string | number;
  trained?: string;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const [url, setUrl] = useState(localStorage.getItem("api_base") || "https://healthcare-ai-backend-qcr3.onrender.com");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true); setStatus(null);
    try {
      const r = await fetch(url + "/api/status");
      const data = await r.json() as { auc_roc?: string | number; trained_at?: string };
      setStatus({ ok: true, auc: data.auc_roc, trained: data.trained_at });
    } catch {
      setStatus({ ok: false });
    }
    setTesting(false);
  };

  const save = () => {
    localStorage.setItem("api_base", url);
    onClose();
    window.location.reload();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(6,10,18,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(4px)"
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <Card style={{ width: 480, maxWidth: "calc(100vw - 2rem)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Server Configuration</span>
          <button onClick={onClose} style={{ background: "none", color: T.muted, fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>

        <p style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Enter the address of your local Python server (<code style={{ fontFamily: "JetBrains Mono", color: "#3a6aff" }}>python app.py</code>).
          This runs on the hospital machine — all patient data stays local.
        </p>

        <label className="field-label">Python Server URL</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="http://192.168.1.50:5000" />
          <button className="btn-primary" onClick={test} disabled={testing}
            style={{ whiteSpace: "nowrap" }}>
            {testing ? <Spinner /> : "TEST"}
          </button>
        </div>

        {status && (
          <div style={{
            padding: "10px 14px", borderRadius: 6, marginBottom: 16,
            background: status.ok ? "#0d3320" : "#2d0a0a",
            border: `1px solid ${status.ok ? "#1a6640" : "#4a1515"}`,
            color: status.ok ? "#00ff88" : "#ff6666", fontSize: 13
          }}>
            {status.ok
              ? `✓ Connected · Model AUC ${status.auc || "—"} · Trained ${status.trained ? new Date(status.trained).toLocaleDateString() : "—"}`
              : "✕ Could not connect. Check the server is running and the URL is correct."
            }
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: T.border, border: "none", color: T.muted,
            borderRadius: 4, padding: "10px 20px", fontSize: 13,
            fontWeight: 700, fontFamily: "Syne", cursor: "pointer"
          }}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save & Reload</button>
        </div>

        <div style={{ marginTop: 20, padding: "12px 14px", background: T.bg, borderRadius: 6 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: T.muted, marginBottom: 8, textTransform: "uppercase" }}>
            GDPR Note
          </div>
          <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            The React app runs on Netlify. It connects to your local Python server to run predictions.
            No patient data is ever sent to Netlify — only the visual interface is hosted there.
            The model and all data stay on your hospital machine.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════════ */
type TabId = "single" | "batch" | "live";

interface Tab {
  id: TabId;
  label: string;
}

export default function App() {
  const [tab, setTab] = useState<TabId>("single");
  const [showSettings, setShowSettings] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    api<ModelStatus>("/status").then(r => {
      if (!r.__error) setModelStatus(r);
    });
  }, []);

  const tabs: Tab[] = [
    { id: "single", label: "Single Patient" },
    { id: "batch",  label: "Batch Predict" },
    { id: "live",   label: "Live Dashboard" },
  ];

  const auc = modelStatus?.auc_roc;
  const aucColor = !auc ? T.muted : auc >= 0.85 ? "#00ff88" : auc >= 0.75 ? "#ffaa00" : "#ff4444";

  return (
    <>
      <style>{GLOBAL_CSS}</style>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* ── Top bar ── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 56, position: "sticky",
        top: 0, zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#3a6aff" strokeWidth="1.5" />
            <path d="M8 12h2l2-4 2 8 2-4h2" stroke="#3a6aff" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.5 }}>PALLIATIVE CARE AI</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 2, textTransform: "uppercase" }}>
              Deterioration Prediction System
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {modelStatus && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: modelStatus.status === "ready" ? "#00ff88" : "#ff4444",
                  boxShadow: `0 0 6px ${modelStatus.status === "ready" ? "#00ff88" : "#ff4444"}`
                }} />
                <span style={{ fontSize: 11, color: T.muted }}>
                  {modelStatus.status === "ready" ? "Model ready" : "No model"}
                </span>
              </div>
              {auc && (
                <span className="mono" style={{ fontSize: 11, color: aucColor }}>
                  AUC {auc}
                </span>
              )}
            </div>
          )}
          <button onClick={() => setShowSettings(true)}
            style={{
              background: "none", border: `1px solid ${T.border}`,
              color: T.muted, borderRadius: 4, padding: "5px 12px",
              fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", fontFamily: "Syne",
              cursor: "pointer", transition: "color 0.15s, border-color 0.15s"
            }}
            onMouseEnter={e => {
              (e.target as HTMLButtonElement).style.color = T.text;
              (e.target as HTMLButtonElement).style.borderColor = T.borderHi;
            }}
            onMouseLeave={e => {
              (e.target as HTMLButtonElement).style.color = T.muted;
              (e.target as HTMLButtonElement).style.borderColor = T.border;
            }}
          >
            ⚙ SERVER
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 24px", display: "flex", gap: 4
      }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ padding: "24px", maxWidth: 1280, margin: "0 auto" }} key={tab}>
        <div className="fade-up">
          {tab === "single" && <SinglePatient />}
          {tab === "batch"  && <BatchPredict />}
          {tab === "live"   && <LiveDashboard />}
        </div>
      </div>
    </>
  );
}