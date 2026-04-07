// src/services/azureService.ts
export interface DataItem {
  id: number;
  fecha: string;
  categoria: string;   // Modalidad
  nivelAcademico: string;      // Nivel
  rectoria?: string;
  ceco?: string;
  snies?: string;
  centro?: string;               // Centro Universitario
  sede?: string;
  centroOperacion?: string;
  facultad?: string;
  abreviatura?: string;
  siglasPrograma?: string;
  programa?: string;             // Programa Académico
  periodo?: string;
  periodicidad?: string;
  nuevos?: number;
  continuos?: number;
  totales?: number;
  graduados?: number;
}

export interface FiltersMulti {
  years?: string[];        // multiselect
  modalidades?: string[];
  niveles?: string[];
  periodos?: string[];     // S1/S2/Q1/Q2/Q3
  centros?: string[];
  page?: number;
  pageSize?: number;
}

const API_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_API_URL) ||
  "https://three60-resumen-backend.onrender.com";

const TABLE = encodeURIComponent("Poblacion Estudiantil");

// ---- Helpers ----
const toCsv = (arr?: string[]) =>
  (arr && arr.length ? arr.map(s => String(s).trim()).filter(Boolean).join(",") : undefined);

const toCsvUpper = (arr?: string[]) =>
  (arr && arr.length ? arr.map(s => String(s).trim().toUpperCase()).filter(Boolean).join(",") : undefined);

const num = (v: unknown) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const normalized = String(v)
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

// Mapea una fila cruda de SQL a DataItem
const mapRow = (item: any, index: number): DataItem => ({

  id: index,
  fecha: String(item["Año"] ?? ""),
  categoria: String(item["Modalidad"] ?? ""),
  nivelAcademico: String(item["Nivel"] ?? ""),
  rectoria: item["Rectoría"] ?? "",
  ceco: item["CECO"] ?? "",
  snies: item["SNIES"] ?? "",
  centro: item["Centro Universitario"] ?? "",
  sede: item["Sede"] ?? "",
  centroOperacion: item["Centro de Operación"] ?? "",
  facultad: item["Facultad"] ?? "",
  abreviatura: item["Abreviatura siglas"] ?? "",
  siglasPrograma: item["Siglas Programa"] ?? "",
  programa: item["Programa Académico"] ?? "",
  periodo: String(item["Periodo"] ?? ""),
  periodicidad: item["Periodicidad"] ?? "",
  nuevos: Number(item["Estudiantes Nuevos"] ?? 0),
  continuos: Number(item["Estudiantes Continuos"] ?? 0),
  totales: Number(item["Estudiantes Totales"] ?? 0),
  graduados: Number(item["Graduados"] ?? 0),
});

// ============ Carga base (para combos) ============
// Trae 2020–2026 por defecto gracias al backend.
export async function fetchAzureData(): Promise<DataItem[]> {
  const res = await fetch(
    `${API_URL}/api/datos/${TABLE}?page=1&pageSize=500000&_ts=${Date.now()}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Error al obtener base");
  const payload = await res.json();
  const raw = Array.isArray(payload) ? payload : (payload?.rows ?? []);
  return raw.map(mapRow);
}

// ============ Tabla (si la usas en otra vista) ============
export async function fetchTableMulti(
  f: FiltersMulti
): Promise<{ total: number; rows: DataItem[] }> {
  const qs = new URLSearchParams();
  const yearsCsv = toCsv(f.years);
  const modsCsv = toCsv(f.modalidades);
  const nivCsv = toCsv(f.niveles);
  const perCsv = toCsvUpper(f.periodos);
  const cenCsv = toCsv(f.centros);

  if (yearsCsv) qs.set("years", yearsCsv);
  if (modsCsv) qs.set("modalidades", modsCsv);
  if (nivCsv) qs.set("niveles", nivCsv);
  if (perCsv) qs.set("periodos", perCsv);
  if (cenCsv) qs.set("centros", cenCsv);

  qs.set("page", String(f.page ?? 1));
  qs.set("pageSize", String(f.pageSize ?? 20000));
  qs.set("_ts", String(Date.now()));

  const url = `${API_URL}/api/datos/${TABLE}?${qs.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Error /api/datos: ${res.status}`);
  const payload = await res.json();
  const raw = Array.isArray(payload) ? payload : (payload?.rows ?? []);
  const total = Array.isArray(payload) ? raw.length : (payload?.total ?? raw.length);

  return { total, rows: raw.map(mapRow) };
}

// ============ Analytics (estudios) con multiselección ============
export async function fetchAnalyticsMulti(f: FiltersMulti): Promise<{
  stats: { estudiantes: number; centros: number; modalidades: number; programas: number };
  modalidadBreakdown: Array<{ nivelAcademico: string; categoria: string; nuevos: number; continuos: number; totales: number }>;
  trend: Array<{ fecha: string; valor: number }>;
  ausDes: Array<{ modalidad: string; ausentes: number; pct_ausentes: number; desertores: number; pct_desertores: number }>;
  byCentro: Array<{
  categoria: string;
  nuevos: number;
  continuos: number;
  total: number;
  modalidades?: {
    modalidad: string;
    nuevos: number;
    continuos: number;
    total: number;
  }[];
}>;
  byEscuela: Array<{
  centro: string;
  centroOperacion: string;
  escuela: string;
  total: number;
}>
  virtual2026S1: Array<{ estado: string; nivelAcademico?: string; Bogota: number; Total: number }>;
}> {
  const body: any = {
    table: "Poblacion Estudiantil",
    years: toCsv(f.years),
    modalidades: toCsv(f.modalidades),
    niveles: toCsv(f.niveles),
    periodos: toCsvUpper(f.periodos),
    centros: toCsv(f.centros),
  };

  const res = await fetch(`${API_URL}/api/analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Error /api/analytics: ${res.status} - ${t}`);
  }

  const j = await res.json();

  return {
    stats: j?.stats ?? { estudiantes: 0, centros: 0, modalidades: 0, programas: 0 },
modalidadBreakdown: (j?.modalidadBreakdown ?? []).map((d: any) => ({
  nivelAcademico: String(d.nivelAcademico ?? ""), // 👈 CLAVE
  categoria: String(d.categoria ?? ""),
  nuevos: num(d.nuevos),
  continuos: num(d.continuos),
  totales: num(d.totales),
})),
    trend: (j?.trend ?? []).map((d: any) => ({
      fecha: String(d.fecha ?? ""),
      valor: num(d.valor),
    })),
    ausDes: (j?.ausDes ?? []).map((d: any) => ({
      modalidad: String(d.modalidad ?? ""),
      ausentes: num(d.ausentes),
      pct_ausentes: num(d.pct_ausentes),
      desertores: num(d.desertores),
      pct_desertores: num(d.pct_desertores),
    })),
    byCentro: (j?.byCentro ?? []).map((d: any) => ({
  categoria: String(d.categoria ?? ""),
  nuevos: num(d.nuevos),
  continuos: num(d.continuos),
  total: num(d.total),
  operaciones: (d.operaciones ?? []).map((o: any) => ({
    nombre: String(o.nombre ?? ""),
    nuevos: num(o.nuevos),
    continuos: num(o.continuos),
    total: num(o.total),
    modalidades: (o.modalidades ?? []).map((m: any) => ({
      modalidad: String(m.modalidad ?? ""),
      nuevos: num(m.nuevos),
      continuos: num(m.continuos),
      total: num(m.total),
    })),
  })),
})),
  byEscuela: (j?.byEscuela ?? []).map((d: any) => ({
  centro: String(d.centro ?? ""),

  // 🔥 FIX ROBUSTO
  centroOperacion: String(
    d.centroOperacion ??
    d["Centro de Operación"] ??
    d["Centro de Operacion"] ?? // sin tilde
    d.centro ?? ""
  ),

  escuela: String(d.escuela ?? ""),
  total: num(d.total),
})),
    virtual2026S1: (j?.virtual2026S1 ?? []).map((d: any) => ({
      estado: String(d.estado ?? ""),
      nivelAcademico: String(
        d.nivelAcademico ??
        d.nivel ??
        d.Nivel ??
        d["Nivel"] ??
        ""
      ),
      Bogota: num(d.Bogota ?? d.valor ?? d.Valor),
      Total: num(d.Total ?? d.valor ?? d.Valor),
    })),
  };
}
