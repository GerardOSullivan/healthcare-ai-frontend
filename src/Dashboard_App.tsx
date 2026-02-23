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
   TYPES — Updated for PCNA schema
═══════════════════════════════════════════════════════════════════ */
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | "NONE";
type FilterLevel = "ALL" | RiskLevel;
type SortBy = "risk" | "id";

interface RiskStyle {
  fill: string;
  stroke: string;
  glow: string;
  label: string;
  icon: string;
}

// PCNA-specific form — replacing old vitals fields
interface ResidentForm {
  // Intake / demographics
  age: number;
  gender: number;
  incontinence: number;
  catheter: number;
  wound_history: number;
  pressure_ulcer_history: number;
  falls_count: number;
  infections_count: number;
  medical_history_complexity: number;
  // Monthly assessments
  abbey_pain_latest: number;
  abbey_pain_max: number;
  abbey_pain_trend: number;
  must_latest: number;
  must_max: number;
  weight_loss_kg: number;
  weight_loss_pct: number;
  // Quarterly assessments
  barthel_latest: number;
  barthel_min: number;
  barthel_trend: number;
  frase_latest: number;
  frase_max: number;
  frailty_latest: number;
  frailty_max: number;
  mts_latest: number;
  mts_trend: number;
  oral_latest: number;
  oral_trend: number;
  // Nursing notes signals
  note_count_total: number;
  note_concern_count: number;
  note_concern_density: number;
  priority_note_count: number;
  night_note_count: number;
}

interface PredictionResult {
  risk_score: number;
  risk_percent: string;
  alert_level: RiskLevel;
  alert_label: string;
  action: string;
  model_auc: string | number;
  predicted_at: string;
  __error?: string;
}

interface BatchResult {
  alert_breakdown: Partial<Record<RiskLevel, number>>;
  total_residents: number;
  flagged_for_pcna: number;
  high_risk_residents: ResidentSummary[];
  __error?: string;
}

interface ResidentSummary {
  resident_id?: string;
  risk_score: number;
  alert_level: RiskLevel;
  alert_label?: string;
  action: string;
  age?: number;
  frailty_latest?: number;
  barthel_latest?: number;
  barthel_trend?: number;
  abbey_pain_latest?: number;
  must_latest?: number;
  weight_loss_kg?: number;
  falls_count?: number;
  note_concern_density?: number;
  priority_note_count?: number;
}

interface ModelStatus {
  status: "ready" | "no_model";
  auc_roc?: number;
  trained_at?: string;
  feature_count?: number;
  __error?: string;
}

/* ═══════════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════════ */
const T = {
  bg:       "#04080f",
  surface:  "#080e1a",
  surfaceHi:"#0c1425",
  border:   "#141e35",
  borderHi: "#1e2e4a",
  text:     "#d0e4f8",
  muted:    "#3d5470",
  accent:   "#0066ff",
  LOW:    { fill: "#041a10", stroke: "#0a3d22", glow: "#00e676", label: "LOW RISK",  icon: "◆" },
  MEDIUM: { fill: "#1a1000", stroke: "#4d3300", glow: "#ffb300", label: "MONITOR",   icon: "▲" },
  HIGH:   { fill: "#1a0606", stroke: "#5c1010", glow: "#ff3d3d", label: "HIGH RISK", icon: "■" },
  URGENT: { fill: "#1a0014", stroke: "#5c0050", glow: "#e040fb", label: "URGENT",    icon: "◉" },
  NONE:   { fill: "#080e1a", stroke: "#141e35", glow: "#3d5470", label: "—",         icon: "○" },
} as const;

const risk = (lvl?: RiskLevel | string): RiskStyle =>
  (T as unknown as Record<string, RiskStyle>)[lvl ?? ""] ?? T.NONE;

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL STYLES — mobile-first
═══════════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    background: #04080f;
    color: #d0e4f8;
    font-family: 'Outfit', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    min-height: 100vh;
  }
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: #04080f; }
  ::-webkit-scrollbar-thumb { background: #141e35; border-radius: 2px; }

  input, select, textarea {
    font-family: 'DM Mono', monospace;
    background: #04080f;
    border: 1px solid #141e35;
    color: #d0e4f8;
    border-radius: 6px;
    padding: 9px 12px;
    font-size: 13px;
    outline: none;
    width: 100%;
    transition: border-color 0.15s, box-shadow 0.15s;
    -webkit-appearance: none;
  }
  input:focus, select:focus {
    border-color: #0066ff;
    box-shadow: 0 0 0 3px rgba(0,102,255,0.12);
  }
  input[type=range] {
    padding: 0; background: none; border: none;
    cursor: pointer; accent-color: #0066ff; height: 20px;
  }
  input[type=checkbox] { width: auto; cursor: pointer; accent-color: #0066ff; }
  button { font-family: 'Outfit', sans-serif; cursor: pointer; border: none; outline: none; }
  select option { background: #080e1a; }

  @keyframes fadeUp   { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse    { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  @keyframes spin     { to { transform: rotate(360deg); } }
  @keyframes arcIn    { from { stroke-dashoffset: 283; } }
  @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }

  .fade-up  { animation: fadeUp 0.4s cubic-bezier(.2,.8,.4,1) both; }
  .fade-in  { animation: fadeIn 0.3s ease both; }
  .pulsing  { animation: pulse 2s ease-in-out infinite; }

  .tab-btn {
    background: none; border: none; color: #3d5470;
    font-size: 11px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px 16px;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    cursor: pointer; white-space: nowrap;
    font-family: 'Outfit', sans-serif;
  }
  .tab-btn:hover { color: #d0e4f8; }
  .tab-btn.active { color: #0066ff; border-bottom-color: #0066ff; }

  .field-label {
    font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
    color: #3d5470; margin-bottom: 5px; display: block; font-family: 'Outfit', sans-serif;
  }

  .btn-primary {
    background: #0052cc;
    color: #fff; border-radius: 6px;
    font-weight: 700; font-size: 13px; letter-spacing: 1px;
    text-transform: uppercase; padding: 12px 24px;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    font-family: 'Outfit', sans-serif;
  }
  .btn-primary:hover:not(:disabled) {
    background: #0066ff;
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0,102,255,0.3);
  }
  .btn-primary:active:not(:disabled) { transform: translateY(0); }
  .btn-primary:disabled { background: #141e35; color: #3d5470; cursor: not-allowed; }

  /* Mobile-first grid helpers */
  .two-col {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 480px) {
    .two-col { grid-template-columns: 1fr 1fr; }
  }

  /* Single patient layout: result first on mobile, side-by-side on desktop */
  .single-layout {
    display: flex;
    flex-direction: column-reverse;
    gap: 16px;
  }
  @media (min-width: 900px) {
    .single-layout {
      flex-direction: row;
      align-items: flex-start;
    }
    .single-layout .form-col { flex: 1; min-width: 0; }
    .single-layout .result-col { width: 320px; flex-shrink: 0; position: sticky; top: 112px; }
  }

  /* Live dashboard cards */
  .resident-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 500px) {
    .resident-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (min-width: 900px) {
    .resident-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (min-width: 1200px) {
    .resident-grid { grid-template-columns: repeat(4, 1fr); }
  }

  /* Summary stat cards */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  @media (min-width: 600px) {
    .stat-grid { grid-template-columns: repeat(4, 1fr); }
  }

  /* Table scroll on mobile */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Filter buttons wrap */
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  /* Toggle switch */
  .toggle {
    width: 36px; height: 20px; border-radius: 10px;
    background: #141e35; position: relative;
    transition: background 0.2s; cursor: pointer; flex-shrink: 0;
  }
  .toggle.on { background: #0052cc; }
  .toggle::after {
    content: ''; position: absolute;
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff; top: 3px; left: 3px;
    transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .toggle.on::after { left: 19px; }

  /* Responsive top bar */
  .topbar-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .model-status-text { display: none; }
  @media (min-width: 600px) {
    .model-status-text { display: inline; }
  }

  /* Batch upload area */
  .drop-zone {
    border: 2px dashed #141e35;
    border-radius: 8px; padding: 2rem 1.5rem;
    text-align: center; cursor: pointer;
    background: #080e1a;
    transition: all 0.2s; margin-bottom: 16px;
  }
  .drop-zone.drag { border-color: #0066ff; background: #060e20; }
  .drop-zone:hover { border-color: #1e2e4a; }

  /* Section divider */
  .section-label {
    font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
    color: #3d5470; margin: 20px 0 12px;
    display: flex; align-items: center; gap: 10px;
  }
  .section-label::before, .section-label::after {
    content: ''; flex: 1; height: 1px; background: #141e35;
  }
`;

/* ═══════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
═══════════════════════════════════════════════════════════════════ */
function Card({ children, style, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: "1.25rem", ...style
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

function RiskOrb({ score, level, size = 110 }: { score?: number | null; level?: RiskLevel | string; size?: number }) {
  const r = risk(level);
  const pct = score != null ? Math.round(score * 100) : null;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * (score || 0));

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {level && level !== "NONE" && score != null && score > 0.1 && (
        <div style={{
          position: "absolute", inset: "15%", borderRadius: "50%",
          background: r.glow, opacity: 0.07, filter: "blur(16px)",
          animation: "pulse 2.5s ease-in-out infinite"
        }} />
      )}
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke={T.border} strokeWidth="5" />
        {score != null && (
          <circle cx="50" cy="50" r={radius} fill="none"
            stroke={r.glow} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1), stroke 0.4s" }}
            filter={`drop-shadow(0 0 5px ${r.glow})`}
          />
        )}
        <text x="50" y="46" textAnchor="middle"
          fontSize="19" fontWeight="700" fontFamily="'DM Mono'"
          fill={pct != null ? r.glow : T.muted}>
          {pct != null ? `${pct}` : "—"}
        </text>
        {pct != null && (
          <text x="50" y="59" textAnchor="middle"
            fontSize="8" fontFamily="'Outfit'" fontWeight="600"
            fill={T.muted} letterSpacing="2">
            RISK %
          </text>
        )}
      </svg>
    </div>
  );
}

function AlertChip({ level, label }: { level?: RiskLevel | string; label?: string }) {
  const r = risk(level);
  if (!level) return null;
  return (
    <span style={{
      background: r.fill, border: `1px solid ${r.stroke}`,
      color: r.glow, borderRadius: 4, padding: "3px 9px",
      fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
      textTransform: "uppercase", fontFamily: "'Outfit'",
      boxShadow: `0 0 8px ${r.glow}20`, whiteSpace: "nowrap"
    }}>
      {r.icon} {label || r.label}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 15, height: 15, border: "2px solid #141e35",
      borderTopColor: "#0066ff", borderRadius: "50%",
      animation: "spin 0.7s linear infinite", display: "inline-block", flexShrink: 0
    }} />
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "#150404", border: "1px solid #3d0a0a",
      borderRadius: 6, padding: "12px 16px",
      color: "#ff6b6b", fontSize: 13, marginTop: 12, lineHeight: 1.5
    }}>
      ⚠ {msg}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FIELD COMPONENTS
═══════════════════════════════════════════════════════════════════ */
function Field({
  label, name, value, onChange, type = "number", options, min, max, step = "1", hint
}: {
  label: string; name: string; value: string | number;
  onChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  type?: string; options?: string[]; min?: number; max?: number; step?: string; hint?: string;
}) {
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
      {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function BoolField({ label, name, value, onChange, hint }: {
  label: string; name: string; value: number;
  onChange: (name: string, val: number) => void; hint?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 }}>
      <div>
        <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>{hint}</div>}
      </div>
      <div className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(name, value ? 0 : 1)} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DEFAULT FORM + PRESETS — PCNA schema
═══════════════════════════════════════════════════════════════════ */
const DEFAULT: ResidentForm = {
  age: 78, gender: 2,
  incontinence: 0, catheter: 0, wound_history: 0, pressure_ulcer_history: 0,
  falls_count: 0, infections_count: 0, medical_history_complexity: 2,
  abbey_pain_latest: 0, abbey_pain_max: 0, abbey_pain_trend: 0,
  must_latest: 0, must_max: 0, weight_loss_kg: 0, weight_loss_pct: 0,
  barthel_latest: 90, barthel_min: 88, barthel_trend: 0,
  frase_latest: 3, frase_max: 4, frailty_latest: 3, frailty_max: 3,
  mts_latest: 9, mts_trend: 0, oral_latest: 46, oral_trend: 0,
  note_count_total: 4, note_concern_count: 0, note_concern_density: 0,
  priority_note_count: 0, night_note_count: 1,
};

const PRESETS: Record<string, { label: string; form: ResidentForm }> = {
  stable: {
    label: "Stable",
    form: {
      ...DEFAULT,
      incontinence: 0, catheter: 0, falls_count: 0, infections_count: 0,
      medical_history_complexity: 1,
      abbey_pain_latest: 0, abbey_pain_max: 1, abbey_pain_trend: 0,
      must_latest: 0, must_max: 0, weight_loss_kg: 0.5, weight_loss_pct: 0.6,
      barthel_latest: 98, barthel_min: 97, barthel_trend: 0,
      frase_latest: 1, frase_max: 2, frailty_latest: 2, frailty_max: 2,
      mts_latest: 10, mts_trend: 0, oral_latest: 48, oral_trend: 0,
      note_concern_count: 0, note_concern_density: 0, priority_note_count: 0,
    },
  },
  monitor: {
    label: "Monitor",
    form: {
      ...DEFAULT, age: 82, gender: 1,
      incontinence: 1, falls_count: 1, infections_count: 1,
      medical_history_complexity: 3,
      abbey_pain_latest: 3, abbey_pain_max: 5, abbey_pain_trend: 2,
      must_latest: 1, must_max: 2, weight_loss_kg: -2.5, weight_loss_pct: -3.1,
      barthel_latest: 78, barthel_min: 72, barthel_trend: -8,
      frase_latest: 7, frase_max: 8, frailty_latest: 5, frailty_max: 5,
      mts_latest: 7, mts_trend: -1, oral_latest: 40, oral_trend: -4,
      note_concern_count: 5, note_concern_density: 1.2, priority_note_count: 1, night_note_count: 2,
    },
  },
  urgent: {
    label: "Urgent",
    form: {
      ...DEFAULT, age: 91, gender: 2,
      incontinence: 1, catheter: 1, wound_history: 1, pressure_ulcer_history: 1,
      falls_count: 3, infections_count: 2, medical_history_complexity: 5,
      abbey_pain_latest: 8, abbey_pain_max: 11, abbey_pain_trend: 5,
      must_latest: 3, must_max: 4, weight_loss_kg: -8.0, weight_loss_pct: -10.5,
      barthel_latest: 18, barthel_min: 12, barthel_trend: -35,
      frase_latest: 14, frase_max: 16, frailty_latest: 8, frailty_max: 8,
      mts_latest: 1, mts_trend: -5, oral_latest: 22, oral_trend: -14,
      note_count_total: 12, note_concern_count: 28, note_concern_density: 2.3,
      priority_note_count: 4, night_note_count: 5,
    },
  },
};

/* ═══════════════════════════════════════════════════════════════════
   RESULT PANEL — shown first on mobile
═══════════════════════════════════════════════════════════════════ */
function ResultPanel({ result, loading }: { result: PredictionResult | null; loading: boolean }) {
  const hasResult = result && !result.__error;

  return (
    <div className="result-col" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Main risk card */}
      <Card style={{
        textAlign: "center",
        border: hasResult ? `1px solid ${risk(result?.alert_level).stroke}` : `1px solid ${T.border}`,
        background: hasResult ? risk(result?.alert_level).fill : T.surface,
        transition: "all 0.4s ease",
      }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: T.muted, textTransform: "uppercase", marginBottom: 14 }}>
          PCNA Risk Assessment
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          {loading ? (
            <div style={{ width: 110, height: 110, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Spinner />
            </div>
          ) : (
            <RiskOrb score={result?.risk_score} level={result?.alert_level} size={110} />
          )}
        </div>

        {hasResult ? (
          <>
            <div style={{ marginBottom: 10 }}>
              <AlertChip level={result.alert_level} label={result.alert_label} />
            </div>
            <div style={{
              fontSize: 12, color: risk(result.alert_level).glow,
              lineHeight: 1.5, marginTop: 8,
              background: `${risk(result.alert_level).glow}10`,
              border: `1px solid ${risk(result.alert_level).stroke}`,
              borderRadius: 5, padding: "8px 12px"
            }}>
              {result.action}
            </div>
          </>
        ) : (
          <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.6 }}>
            {loading ? "Calculating PCNA risk…" : "Complete the assessment fields and run prediction"}
          </div>
        )}
      </Card>

      {/* Score details */}
      {hasResult && (
        <Card className="fade-in">
          {([
            ["PCNA Risk Score", result.risk_percent, "#0066ff"],
            ["Model AUC", String(result.model_auc), T.muted],
            ["Assessed at", new Date(result.predicted_at).toLocaleTimeString(), T.muted],
          ] as [string, string, string][]).map(([k, v, c]) => (
            <div key={k} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 0", borderBottom: `1px solid ${T.border}`
            }}>
              <span style={{ color: T.muted, fontSize: 12 }}>{k}</span>
              <span style={{ color: c, fontSize: 13, fontWeight: 600, fontFamily: "'DM Mono'" }}>{v}</span>
            </div>
          ))}
          <div style={{ padding: "8px 0", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: T.muted, fontSize: 12 }}>Model AUC</span>
            <span style={{ color: T.muted, fontSize: 13, fontFamily: "'DM Mono'" }}>{result.model_auc}</span>
          </div>
        </Card>
      )}

      {/* Clinical score reference */}
      <Card style={{ padding: "1rem" }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: T.muted, textTransform: "uppercase", marginBottom: 10 }}>
          Key Scale Reference
        </div>
        {([
          ["Barthel 0–100", "Higher = more independent"],
          ["Frailty 1–9",   "Higher = more frail"],
          ["FRASE 0–20+",   "Higher = greater fall risk"],
          ["MUST 0–6",      "≥2 = high nutritional risk"],
          ["Abbey Pain 0–18","Higher = more pain"],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontFamily: "'DM Mono'", color: T.text, fontSize: 11 }}>{k}</span>
            <span style={{ color: T.muted, fontSize: 10, textAlign: "right", maxWidth: "55%" }}>{v}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 1 — SINGLE RESIDENT ASSESSMENT
═══════════════════════════════════════════════════════════════════ */
function SingleResident() {
  const [form, setForm] = useState<ResidentForm>(DEFAULT);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (e) => {
    const { name, value, type } = e.target;
    setForm(f => ({ ...f, [name]: type === "number" || !isNaN(+value) ? parseFloat(value) || 0 : value }));
  };

  const toggleBool = (name: string, val: number) => setForm(f => ({ ...f, [name]: val }));

  const predict = async () => {
    setLoading(true); setError(null);
    const res = await api<PredictionResult>("/predict/single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.__error) { setError(res.__error); }
    else { setResult(res); }
  };

  return (
    <div className="single-layout">

      {/* ── Form column ── */}
      <div className="form-col">
        {/* Presets */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: T.muted, textTransform: "uppercase" }}>Preset</span>
          {Object.entries(PRESETS).map(([key, { label }]) => (
            <button key={key}
              onClick={() => { setForm(PRESETS[key].form); setResult(null); setError(null); }}
              style={{
                background: T.border, border: "none", color: T.muted,
                borderRadius: 4, padding: "5px 14px", fontSize: 10,
                fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", fontFamily: "'Outfit'",
                transition: "color 0.15s, background 0.15s"
              }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = T.text; (e.target as HTMLButtonElement).style.background = T.borderHi; }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = T.muted; (e.target as HTMLButtonElement).style.background = T.border; }}
            >{label}</button>
          ))}
        </div>

        <Card>
          {/* Intake */}
          <SectionLabel>Intake / Demographics</SectionLabel>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Age (years)" name="age" value={form.age} onChange={change} min={18} max={110} />
            <Field label="Gender" name="gender" value={form.gender} onChange={change}
              options={["1", "2", "3"]}
              hint="1=Male  2=Female  3=Not specified" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Number of Medical Conditions" name="medical_history_complexity"
              value={form.medical_history_complexity} onChange={change} min={0} max={20}
              hint="Count from medical history" />
            <Field label="Falls (prev 6–9 months)" name="falls_count" value={form.falls_count} onChange={change} min={0} max={30} />
          </div>
          <Field label="Infections (prev 6–9 months)" name="infections_count" value={form.infections_count} onChange={change} min={0} max={20} />

          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <BoolField label="Urine/Bowel Incontinence" name="incontinence" value={form.incontinence} onChange={toggleBool} />
            <BoolField label="Urinary Catheter" name="catheter" value={form.catheter} onChange={toggleBool} />
            <BoolField label="Wound (prev 6–9 months)" name="wound_history" value={form.wound_history} onChange={toggleBool} />
            <BoolField label="Pressure Ulcer (prev 6–9 months)" name="pressure_ulcer_history" value={form.pressure_ulcer_history} onChange={toggleBool} />
          </div>

          {/* Monthly */}
          <SectionLabel>Monthly Assessments</SectionLabel>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Abbey Pain Scale (latest)" name="abbey_pain_latest" value={form.abbey_pain_latest} onChange={change} min={0} max={18} hint="0=No pain, 18=Severe" />
            <Field label="Abbey Pain Scale (highest)" name="abbey_pain_max" value={form.abbey_pain_max} onChange={change} min={0} max={18} />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Abbey Pain Trend" name="abbey_pain_trend" value={form.abbey_pain_trend} onChange={change} min={-18} max={18} hint="+ve = worsening" />
            <Field label="MUST Score (latest)" name="must_latest" value={form.must_latest} onChange={change} min={0} max={6} hint="≥2 = high nutrition risk" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="MUST Score (highest)" name="must_max" value={form.must_max} onChange={change} min={0} max={6} />
            <Field label="Weight Change (kg)" name="weight_loss_kg" value={form.weight_loss_kg} onChange={change} step="0.1" hint="Negative = weight loss" />
          </div>
          <Field label="Weight Change (%)" name="weight_loss_pct" value={form.weight_loss_pct} onChange={change} step="0.1" hint="Negative = weight loss" />

          {/* Quarterly */}
          <SectionLabel>Quarterly Assessments</SectionLabel>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Barthel Index (latest)" name="barthel_latest" value={form.barthel_latest} onChange={change} min={0} max={100} hint="0=fully dependent, 100=independent" />
            <Field label="Barthel Index (lowest)" name="barthel_min" value={form.barthel_min} onChange={change} min={0} max={100} />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Barthel Trend" name="barthel_trend" value={form.barthel_trend} onChange={change} min={-100} max={20} hint="Negative = declining" />
            <Field label="FRASE Fall Risk (latest)" name="frase_latest" value={form.frase_latest} onChange={change} min={0} max={25} hint="Higher = greater fall risk" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="FRASE Fall Risk (highest)" name="frase_max" value={form.frase_max} onChange={change} min={0} max={25} />
            <Field label="Clinical Frailty Scale (latest)" name="frailty_latest" value={form.frailty_latest} onChange={change} min={1} max={9} hint="1=Very fit, 9=Terminally ill" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Clinical Frailty Scale (highest)" name="frailty_max" value={form.frailty_max} onChange={change} min={1} max={9} />
            <Field label="Mental Test Score (latest)" name="mts_latest" value={form.mts_latest} onChange={change} min={0} max={10} hint="0=severe impairment" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Mental Test Score Trend" name="mts_trend" value={form.mts_trend} onChange={change} min={-10} max={5} hint="Negative = declining" />
            <Field label="Oral Cavity Score (latest)" name="oral_latest" value={form.oral_latest} onChange={change} min={12} max={56} hint="12=severe, 56=healthy" />
          </div>
          <Field label="Oral Cavity Trend" name="oral_trend" value={form.oral_trend} onChange={change} min={-44} max={10} hint="Negative = worsening" />

          {/* Nursing notes */}
          <SectionLabel>Nursing Notes Signals</SectionLabel>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Total Notes on File" name="note_count_total" value={form.note_count_total} onChange={change} min={0} max={200} />
            <Field label="Concern Keywords (total hits)" name="note_concern_count" value={form.note_concern_count} onChange={change} min={0} max={500} hint="Pain, fall, deteriorat…" />
          </div>
          <div className="two-col" style={{ marginBottom: 12 }}>
            <Field label="Concern Density (per note)" name="note_concern_density" value={form.note_concern_density} onChange={change} step="0.1" min={0} hint="Concern hits ÷ note count" />
            <Field label="Priority Notes" name="priority_note_count" value={form.priority_note_count} onChange={change} min={0} max={50} />
          </div>
          <Field label="Night Notes" name="night_note_count" value={form.night_note_count} onChange={change} min={0} max={50} />

          <button className="btn-primary" onClick={predict} disabled={loading}
            style={{ marginTop: 20, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading ? <><Spinner /> Calculating…</> : "▶  Run PCNA Prediction"}
          </button>
          {error && <ErrorBox msg={error} />}
        </Card>
      </div>

      {/* ── Result column (shown first on mobile via flex-direction: column-reverse) ── */}
      <ResultPanel result={result} loading={loading} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 2 — BATCH FOLDER PREDICTION
═══════════════════════════════════════════════════════════════════ */
function BatchPredict() {
  const [folderPath, setFolderPath] = useState("");
  const [threshold, setThreshold] = useState(0.5);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!folderPath.trim()) return;
    setLoading(true); setError(null); setResult(null);
    const res = await api<BatchResult>("/predict/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_path: folderPath.trim(), threshold }),
    });
    setLoading(false);
    if (res.__error) setError(res.__error);
    else setResult(res);
  };

  const levels: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  const breakdown = result?.alert_breakdown || {};

  return (
    <div style={{ maxWidth: 900 }}>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: T.muted, textTransform: "uppercase", marginBottom: 12 }}>
          Resident Data Folder
        </div>
        <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 14 }}>
          Enter the path to the PCNA folder on the server machine. Each resident sub-folder should contain
          <span style={{ fontFamily: "DM Mono", color: "#0066ff" }}> t1_*.xlsx</span>,
          <span style={{ fontFamily: "DM Mono", color: "#0066ff" }}> monthly_*.xlsx</span>,
          <span style={{ fontFamily: "DM Mono", color: "#0066ff" }}> quarterly_*.xlsx</span>, and
          <span style={{ fontFamily: "DM Mono", color: "#0066ff" }}> dailyNurseNotes_*.xlsx</span>.
        </p>
        <input
          type="text"
          placeholder="e.g. /home/server/PCNA  or  C:\PCNA_Data"
          value={folderPath}
          onChange={e => setFolderPath(e.target.value)}
          onKeyDown={e => e.key === "Enter" && run()}
          style={{ marginBottom: 12, fontFamily: "DM Mono" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label className="field-label">
              Alert threshold — flag residents above this risk score
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={0.2} max={0.8} step={0.05} value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                style={{ flex: 1, width: "auto" }} />
              <span style={{ color: "#0066ff", fontWeight: 700, minWidth: 40, fontFamily: "DM Mono", fontSize: 14 }}>
                {Math.round(threshold * 100)}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginTop: 4 }}>
              <span>More sensitive</span><span>More conservative</span>
            </div>
          </div>
          <button className="btn-primary" onClick={run} disabled={!folderPath.trim() || loading}
            style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            {loading ? <><Spinner /> Running…</> : "▶ Run Batch"}
          </button>
        </div>
      </Card>

      {error && <ErrorBox msg={error} />}

      {result && (
        <div className="fade-up">
          {/* Summary counts */}
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            {levels.map(lvl => {
              const r = risk(lvl);
              const count = breakdown[lvl] || 0;
              const total = result.total_residents || 1;
              const pct = Math.round(count / total * 100);
              return (
                <div key={lvl} style={{
                  background: r.fill, border: `1px solid ${r.stroke}`,
                  borderRadius: 8, padding: "1rem", textAlign: "center",
                  boxShadow: count > 0 ? `0 0 14px ${r.glow}15` : "none"
                }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: r.glow, fontFamily: "DM Mono" }}>{count}</div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: r.glow, textTransform: "uppercase", marginTop: 2 }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{pct}%</div>
                </div>
              );
            })}
          </div>

          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>
                {result.total_residents} residents scored · {result.flagged_for_pcna} flagged for PCNA
              </span>
            </div>
          </Card>

          {(result.high_risk_residents?.length ?? 0) > 0 && (
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#ff3d3d" }}>
                  Flagged Residents — {result.high_risk_residents.length}
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>Sorted by risk</span>
              </div>
              <div className="table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 560 }}>
                  <thead>
                    <tr>
                      {["Resident ID", "Risk", "Level", "Frailty", "Barthel", "Action"].map(h => (
                        <th key={h} style={{
                          textAlign: "left", padding: "8px 10px",
                          color: T.muted, borderBottom: `1px solid ${T.border}`,
                          fontSize: 9, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.high_risk_residents]
                      .sort((a, b) => b.risk_score - a.risk_score)
                      .map((p, i) => {
                        const r = risk(p.alert_level);
                        return (
                          <tr key={i}
                            style={{ borderBottom: `1px solid ${T.bg}`, transition: "background 0.1s" }}
                            onMouseEnter={e => (e.currentTarget.style.background = T.surfaceHi)}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <td style={{ padding: "10px 10px", color: T.text, fontFamily: "DM Mono", fontSize: 12 }}>{p.resident_id ?? "—"}</td>
                            <td style={{ padding: "10px 10px", color: r.glow, fontWeight: 700, fontFamily: "DM Mono" }}>
                              {(p.risk_score * 100).toFixed(1)}%
                            </td>
                            <td style={{ padding: "10px 10px" }}><AlertChip level={p.alert_level} /></td>
                            <td style={{ padding: "10px 10px", color: T.muted, fontFamily: "DM Mono" }}>{p.frailty_latest ?? "—"}</td>
                            <td style={{ padding: "10px 10px", color: T.muted, fontFamily: "DM Mono" }}>{p.barthel_latest ?? "—"}</td>
                            <td style={{ padding: "10px 10px", color: T.muted, fontSize: 11, maxWidth: 200 }}>{p.action}</td>
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
  const [residents, setResidents] = useState<ResidentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState<FilterLevel>("ALL");
  const [sortBy] = useState<SortBy>("risk");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const res = await api<{ residents?: ResidentSummary[] }>("/alerts/current");
    setLoading(false);
    if (!res.__error && res.residents) {
      setResidents(res.residents);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchAlerts, 60000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchAlerts]);

  const filtered = residents
    .filter(p => filter === "ALL" || p.alert_level === filter)
    .sort((a, b) =>
      sortBy === "risk" ? b.risk_score - a.risk_score
        : (a.resident_id ?? "").localeCompare(b.resident_id ?? "")
    );

  const counts: Record<FilterLevel, number> = { ALL: residents.length, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0, NONE: 0 };
  (["LOW", "MEDIUM", "HIGH", "URGENT"] as RiskLevel[]).forEach(l => {
    counts[l] = residents.filter(p => p.alert_level === l).length;
  });
  const urgentCount = (counts.HIGH || 0) + (counts.URGENT || 0);

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <div className="filter-bar">
          {(["ALL", "LOW", "MEDIUM", "HIGH", "URGENT"] as FilterLevel[]).map(f => {
            const r = f === "ALL" ? { glow: T.text, fill: T.surface, stroke: T.border } : risk(f);
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  background: active ? r.fill : "transparent",
                  border: `1px solid ${active ? r.stroke : T.border}`,
                  color: active ? r.glow : T.muted,
                  borderRadius: 4, padding: "6px 12px",
                  fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                  textTransform: "uppercase", fontFamily: "'Outfit'",
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                {f} ({counts[f]})
              </button>
            );
          })}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={fetchAlerts} disabled={loading}
              style={{
                background: T.surface, border: `1px solid ${T.border}`,
                color: loading ? T.muted : "#0066ff", borderRadius: 4,
                padding: "6px 12px", fontSize: 11, fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "'Outfit'", display: "flex", alignItems: "center", gap: 6
              }}>
              {loading ? <Spinner /> : "↻"} Refresh
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 10, color: autoRefresh ? "#0066ff" : T.muted, fontWeight: 700,
              letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              <div className={`toggle ${autoRefresh ? "on" : ""}`} onClick={() => setAutoRefresh(v => !v)} />
              Auto
            </label>
          </div>
        </div>
      </div>

      {/* Urgent alert banner */}
      {urgentCount > 0 && (
        <div className="pulsing" style={{
          background: "#150606", border: "1px solid #5c1010",
          borderRadius: 6, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap"
        }}>
          <span style={{ fontSize: 18 }}>🔴</span>
          <span style={{ color: "#ff3d3d", fontWeight: 700, fontSize: 13, flex: 1, minWidth: 200 }}>
            {urgentCount} resident{urgentCount !== 1 ? "s" : ""} require immediate PCNA review
          </span>
          {lastRefresh && (
            <span style={{ color: T.muted, fontSize: 11 }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Empty states */}
      {residents.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ color: T.muted, fontSize: 14, lineHeight: 1.7 }}>
            No resident data yet.<br />
            Run a batch prediction from the Batch tab — results will appear here.
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: T.muted, fontFamily: "DM Mono" }}>
            python predict.py --data ./PCNA_folder
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ color: T.muted }}>No residents match this filter.</div>
        </Card>
      ) : (
        <div className="resident-grid">
          {filtered.map((p, i) => {
            const r = risk(p.alert_level);
            return (
              <div key={i} className="fade-up" style={{
                animationDelay: `${Math.min(i * 0.04, 0.5)}s`,
                background: r.fill, border: `1px solid ${r.stroke}`,
                borderRadius: 8, padding: "1.1rem",
                boxShadow: p.alert_level === "URGENT" ? `0 0 18px ${r.glow}20` : "none",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "none")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>Resident</div>
                    <div style={{ color: T.text, fontWeight: 700, fontSize: 14, fontFamily: "DM Mono", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.resident_id ?? "—"}
                    </div>
                  </div>
                  <AlertChip level={p.alert_level} label={p.alert_label} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <RiskOrb score={p.risk_score} level={p.alert_level} size={66} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {([
                      ["Frailty", p.frailty_latest ?? "—"],
                      ["Barthel", p.barthel_latest != null ? `${p.barthel_latest}` : "—"],
                      ["Abbey Pain", p.abbey_pain_latest ?? "—"],
                      ["MUST", p.must_latest ?? "—"],
                    ] as [string, string | number][]).map(([k, v]) => (
                      <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                        <span style={{ color: T.muted }}>{k}</span>
                        <span style={{ fontFamily: "DM Mono", color: T.text, fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  fontSize: 11, color: r.glow,
                  background: `${r.glow}10`, border: `1px solid ${r.stroke}`,
                  borderRadius: 4, padding: "6px 10px", lineHeight: 1.4
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
function SettingsModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(localStorage.getItem("api_base") || API_BASE);
  const [status, setStatus] = useState<{ ok: boolean; auc?: number | string; trained?: string; features?: number } | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true); setStatus(null);
    try {
      const r = await fetch(url + "/api/status");
      const data = await r.json() as { auc_roc?: number; trained_at?: string; feature_count?: number };
      setStatus({ ok: true, auc: data.auc_roc, trained: data.trained_at, features: data.feature_count });
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
      position: "fixed", inset: 0, background: "rgba(4,8,15,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(6px)", padding: "1rem"
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <Card style={{ width: "100%", maxWidth: 480, animation: "slideDown 0.25s ease both" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 0.5 }}>Server Configuration</span>
          <button onClick={onClose} style={{ background: "none", color: T.muted, fontSize: 20, lineHeight: 1, padding: "0 4px" }}>✕</button>
        </div>

        <p style={{ color: T.muted, fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
          Enter the address of your local Python server running{" "}
          <code style={{ fontFamily: "DM Mono", color: "#0066ff", fontSize: 12 }}>python app.py</code>.
          All resident data stays on your local machine.
        </p>

        <label className="field-label">Python Server URL</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="http://192.168.1.50:5000"
            style={{ fontFamily: "DM Mono" }}
          />
          <button className="btn-primary" onClick={test} disabled={testing}
            style={{ whiteSpace: "nowrap", padding: "9px 16px" }}>
            {testing ? <Spinner /> : "Test"}
          </button>
        </div>

        {status && (
          <div style={{
            padding: "10px 14px", borderRadius: 6, marginBottom: 14,
            background: status.ok ? "#041a0d" : "#150404",
            border: `1px solid ${status.ok ? "#0a3d22" : "#3d0a0a"}`,
            color: status.ok ? "#00e676" : "#ff6b6b", fontSize: 13
          }}>
            {status.ok
              ? `✓ Connected · AUC ${status.auc ?? "—"} · ${status.features ?? "?"} features · Trained ${status.trained ? new Date(status.trained).toLocaleDateString() : "—"}`
              : "✕ Could not connect. Check the server is running and accessible."
            }
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: T.border, border: "none", color: T.muted,
            borderRadius: 5, padding: "10px 18px", fontSize: 13,
            fontWeight: 700, fontFamily: "'Outfit'", cursor: "pointer"
          }}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save & Reload</button>
        </div>

        <div style={{ marginTop: 18, padding: "12px 14px", background: T.bg, borderRadius: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: T.muted, marginBottom: 8, textTransform: "uppercase" }}>GDPR</div>
          <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            No resident data is sent to any cloud service. The React interface connects directly to your local server.
            All PCNA assessments and predictions stay on your care home machine.
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

export default function App() {
  const [tab, setTab] = useState<TabId>("single");
  const [showSettings, setShowSettings] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    api<ModelStatus>("/status").then(r => { if (!r.__error) setModelStatus(r); });
  }, []);

  const tabs: { id: TabId; label: string }[] = [
    { id: "single", label: "Assessment" },
    { id: "batch",  label: "Batch" },
    { id: "live",   label: "Dashboard" },
  ];

  const auc = modelStatus?.auc_roc;
  const aucColor = !auc ? T.muted : auc >= 0.85 ? "#00e676" : auc >= 0.75 ? "#ffb300" : "#ff3d3d";
  const isReady = modelStatus?.status === "ready";

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Top bar */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 52, position: "sticky",
        top: 0, zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#0066ff" strokeWidth="1.5" />
            <path d="M7 12h2.5l1.5-4 3 8 1.5-4H18" stroke="#0066ff" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.3 }}>PCNA AI</div>
            <div style={{ fontSize: 8, color: T.muted, letterSpacing: 2, textTransform: "uppercase" }}>
              Palliative Care Assessment
            </div>
          </div>
        </div>

        <div className="topbar-right">
          {modelStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: isReady ? "#00e676" : "#ff3d3d",
                boxShadow: `0 0 6px ${isReady ? "#00e676" : "#ff3d3d"}`
              }} />
              <span className="model-status-text" style={{ fontSize: 11, color: T.muted }}>
                {isReady ? "Model ready" : "No model"}
              </span>
              {auc && (
                <span style={{ fontSize: 11, color: aucColor, fontFamily: "DM Mono", fontWeight: 600 }}>
                  AUC {auc}
                </span>
              )}
            </div>
          )}
          <button onClick={() => setShowSettings(true)}
            style={{
              background: "none", border: `1px solid ${T.border}`,
              color: T.muted, borderRadius: 5, padding: "5px 10px",
              fontSize: 10, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", fontFamily: "'Outfit'",
              cursor: "pointer", transition: "color 0.15s, border-color 0.15s"
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = T.text; (e.target as HTMLButtonElement).style.borderColor = T.borderHi; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = T.muted; (e.target as HTMLButtonElement).style.borderColor = T.border; }}
          >
            ⚙ Server
          </button>
        </div>
      </div>

      {/* Tab bar — scrollable on small screens */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 16px", display: "flex", gap: 0,
        overflowX: "auto", WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none"
      }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px", maxWidth: 1280, margin: "0 auto" }} key={tab}>
        <div className="fade-up">
          {tab === "single" && <SingleResident />}
          {tab === "batch"  && <BatchPredict />}
          {tab === "live"   && <LiveDashboard />}
        </div>
      </div>
    </>
  );
}