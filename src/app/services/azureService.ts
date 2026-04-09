// src/services/azureService.ts

export interface DataItem {
  id: number;
  fecha: string;
  categoria: string;
  nivelAcademico: string;
  rectoria?: string;
  ceco?: string;
  snies?: string;
  centro?: string;
  sede?: string;
  centroOperacion?: string;
  facultad?: string;
  abreviatura?: string;
  siglasPrograma?: string;
  programa?: string;
  periodo?: string;
  periodicidad?: string;
  nuevos?: number;
  continuos?: number;
  totales?: number;
  graduados?: number;
}

export interface FiltersMulti {
  years?: string[];
  modalidades?: string[];
  niveles?: string[];
  periodos?: string[];
  centros?: string[];
  page?: number;
  pageSize?: number;
}

// 🔥 URL dinámica (producción)
const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://three60-resumen-backend.onrender.com";

const TABLE = "Poblacion Estudiantil";

// ================= HELPERS =================

const toCsv = (arr?: string[]) =>
  arr?.length ? arr.map(s => s.trim()).filter(Boolean).join(",") : undefined;

const toCsvUpper = (arr?: string[]) =>
  arr?.length
    ? arr.map(s => s.trim().toUpperCase()).filter(Boolean).join(",")
    : undefined;

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

// 🔥 Timeout para evitar cuelgues
const fetchWithTimeout = async (
  url: string,
  options: any = {},
  timeout = 15000
) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout request")), timeout)
    ),
  ]) as Promise<Response>;
};

// ================= MAP =================

const mapRow = (item: any, index: number): DataItem => ({
  id: index,
  fecha: String(item["Año"] ?? ""),
  categoria: String(item["Modalidad"] ?? ""),
  nivelAcademico: String(item["Nivel Académico"] ?? item["Nivel"] ?? ""),
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
  nuevos: num(item["Estudiantes Nuevos"]),
  continuos: num(item["Estudiantes Continuos"]),
  totales: num(item["Estudiantes Totales"]),
  graduados: num(item["Graduados"]),
});

// ================= FETCH BASE =================

export async function fetchAzureData(): Promise<DataItem[]> {
  const url = `${API_URL}/api/datos/${encodeURIComponent(
    TABLE
  )}?page=1&pageSize=500000&_ts=${Date.now()}`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });

  if (!res.ok) throw new Error(`Error base: ${res.status}`);

  const payload = await res.json();
  const raw = Array.isArray(payload) ? payload : payload?.rows ?? [];

  return raw.map(mapRow);
}

// ================= TABLA =================

export async function fetchTableMulti(
  f: FiltersMulti
): Promise<{ total: number; rows: DataItem[] }> {
  const qs = new URLSearchParams();

  if (toCsv(f.years)) qs.set("years", toCsv(f.years)!);
  if (toCsv(f.modalidades)) qs.set("modalidades", toCsv(f.modalidades)!);
  if (toCsv(f.niveles)) qs.set("niveles", toCsv(f.niveles)!);
  if (toCsvUpper(f.periodos)) qs.set("periodos", toCsvUpper(f.periodos)!);
  if (toCsv(f.centros)) qs.set("centros", toCsv(f.centros)!);

  qs.set("page", String(f.page ?? 1));
  qs.set("pageSize", String(f.pageSize ?? 20000));
  qs.set("_ts", String(Date.now()));

  const url = `${API_URL}/api/datos/${encodeURIComponent(
    TABLE
  )}?${qs.toString()}`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });

  if (!res.ok) throw new Error(`Error tabla: ${res.status}`);

  const payload = await res.json();
  const raw = Array.isArray(payload) ? payload : payload?.rows ?? [];
  const total = Array.isArray(payload)
    ? raw.length
    : payload?.total ?? raw.length;

  return { total, rows: raw.map(mapRow) };
}

// ================= ANALYTICS =================

export async function fetchAnalyticsMulti(f: FiltersMulti) {
  const body = {
    table: TABLE,
    years: toCsv(f.years),
    modalidades: toCsv(f.modalidades),
    niveles: toCsv(f.niveles),
    periodos: toCsvUpper(f.periodos),
    centros: toCsv(f.centros),
  };

  const res = await fetchWithTimeout(`${API_URL}/api/analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Error analytics: ${res.status} - ${t}`);
  }

  const j = await res.json();

  return {
    stats: j?.stats ?? {
      estudiantes: 0,
      centros: 0,
      modalidades: 0,
      programas: 0,
    },

    modalidadBreakdown: (j?.modalidadBreakdown ?? []).map((d: any) => ({
      nivelAcademico: String(d.nivelAcademico ?? ""),
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
      centroOperacion: String(
        d.centroOperacion ??
          d["Centro de Operación"] ??
          d["Centro de Operacion"] ??
          d.centro ??
          ""
      ),
      escuela: String(d.escuela ?? ""),
      total: num(d.total),
    })),

    virtual2026S1: (j?.virtual2026S1 ?? []).map((d: any) => ({
      estado: String(d.estado ?? ""),
      nivelAcademico: String(
        d.nivelAcademico ??
          d.nivel ??
          d["Nivel"] ??
          ""
      ),
      Bogota: num(d.Bogota ?? d.valor),
      Total: num(d.Total ?? d.valor),
    })),
  };
}
