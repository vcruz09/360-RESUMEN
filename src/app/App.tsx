// src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Database, ZoomIn, ZoomOut, PieChart as PieIcon, Gauge } from "lucide-react";
import { FiltersMulti } from "./components/FiltersMulti";
import { DashboardCharts } from "./components/DashboardCharts";
import { fetchAzureData, fetchAnalyticsMulti, FiltersMulti as F } from "./services/azureService";
import { virtual2026S1Data } from "./data/virtual2026S1Data";

function App() {
  // Base de opciones
  const [base, setBase] = useState<{ years: string[]; modalidades: string[]; niveles: string[]; periodos: string[]; centros: string[] }>({
    years: [], modalidades: [], niveles: [], periodos: ["S1","S2","Q1","Q2","Q3"], centros: []
  });

  // Selecciones (por defecto 2020–2026)
  const fechaCorte = "20 de marzo de 2026";
  const [activeTab, setActiveTab] = useState("estudiantes");
  const [selYears, setSelYears] = useState<string[]>(["2026","2025","2024","2023","2022","2021","2020"]);
  const [selModalidades, setSelModalidades] = useState<string[]>([]);
  const [selNiveles, setSelNiveles] = useState<string[]>([]);
  const [selPeriodos, setSelPeriodos] = useState<string[]>([]);
  const [selCentros, setSelCentros] = useState<string[]>([]);

  // Estudios
  const [stats, setStats] = useState<any>(null);
  const [modalidadBreakdown, setModalidadBreakdown] = useState<any[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [ausDes, setAusDes] = useState<any[]>([]);
  const [byCentro, setByCentro] = useState<any[]>([]);
  const [byEscuela, setByEscuela] = useState<any[]>([]);
  
  // 🔥 Virtuales: filtrados dinámicamente según selYears y selPeriodos
  const [virtual2026S1, setVirtual2026S1] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const reqId = useRef(0);

  // Carga base (para combos)
useEffect(() => {
  (async () => {
    try {
      const all = await fetchAzureData();

      // 🔥 NORMALIZADOR GLOBAL
      const normalizeNivel = (nivel: string) => {
        const n = (nivel || "").toLowerCase();

        if (
          n.includes("especial") ||
          n.includes("maestr") ||
          n.includes("doctor")
        ) return "Posgrado";

        return "Pregrado";
      };

      // 🔹 AÑOS
      const years = Array.from(
        new Set(
          all
            .map(d =>
              (d.fecha ?? "")
                .toString()
                .match(/\b(19|20)\d{2}\b/)?.[0]
            )
            .filter(Boolean) as string[]
        )
      )
        .filter(y => Number(y) >= 2020 && Number(y) <= 2026)
        .sort((a, b) => Number(b) - Number(a));

      // 🔹 MODALIDADES
      const modalidades = Array.from(
        new Set(
          all
            .map(d => (d.categoria ?? "").toString().trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

      // 🔥 NIVELES (NORMALIZADOS)
      const niveles = Array.from(
        new Set(
          all.map(d => normalizeNivel(d.nivelAcademico))
        )
      ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

      // 🔹 CENTROS
      const centros = Array.from(
        new Set(
          all
            .map(d => (d.centro ?? "").toString().trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

      // 🔥 LIMPIAR SELECCIÓN ACTUAL DE NIVELES
      setSelNiveles(prev =>
        prev
          .map(normalizeNivel)
          .filter(v => ["Pregrado", "Posgrado"].includes(v))
      );

      // 🔹 SET BASE
      setBase({
        years,
        modalidades,
        niveles,
        periodos: ["S1", "S2", "Q1", "Q2", "Q3"],
        centros,
      });

    } catch (e) {
      console.error(e);
    }
  })();
}, []);



  // Filtros a enviar
  const filters: F = useMemo(() => ({
    years: selYears,
    modalidades: selModalidades,
    niveles: selNiveles,
    periodos: selPeriodos,
    centros: selCentros
  }), [selYears, selModalidades, selNiveles, selPeriodos, selCentros]);

  // Carga de estudios (anti-carrera)
const normalizeNivel = (nivel: string) => {
  const n = (nivel || "").toLowerCase();

  if (
    n.includes("especial") ||
    n.includes("maestr") ||
    n.includes("doctor")
  ) return "Posgrado";

  return "Pregrado";
};

const loadStudies = async (f: F) => {
  setIsLoading(true);
  setErr(null);

  const my = ++reqId.current;

  try {
    const a = await fetchAnalyticsMulti(f);
    if (my !== reqId.current) return;

    // 🔥 NORMALIZAR NIVEL ACADÉMICO
    const modalidadFix = (a.modalidadBreakdown || []).map((d: any) => ({
      ...d,
      nivelAcademico: normalizeNivel(d.nivelAcademico),
    }));

    setStats(a.stats);
    setModalidadBreakdown(modalidadFix);
    setTrend(a.trend);
    setAusDes(a.ausDes);
    setByCentro(a.byCentro);
    setByEscuela(a.byEscuela);
    
    // 🔥 Virtuales: SIEMPRE usar Excel como fuente única
    // NO consultar API, ignorar a.virtual2026S1 completamente
    // Esto garantiza que solo muestra los 59,567 del Excel sin mezclas

  } catch (e: any) {
    if (my !== reqId.current) return;
    setErr(e?.message || "Error");

    setModalidadBreakdown([]);
    setTrend([]);
    setAusDes([]);
    setByCentro([]);
    setByEscuela([]);
    // mantener virtual2026S1 estático cuando la carga falla
    // setVirtual2026S1([]);

  } finally {
    if (my === reqId.current) setIsLoading(false);
  }
};

useEffect(() => {
  loadStudies(filters);
}, [filters]); // eslint-disable-line

// 🔥 Filtrar virtuales por años y períodos seleccionados
useEffect(() => {
  let filtered = virtual2026S1Data;
  
  // Mapeo: período Excel → períodos del filtro
  // Todo lo que es "-1" = S1, Q1, Q2
  // Todo lo que es "-2" = S2, Q3
  const periodMap: Record<string, string[]> = {
    '2025-1': ['S1', 'Q1', 'Q2'],
    '2025-2': ['S2', 'Q3'],
    '2026-1': ['S1', 'Q1', 'Q2'],
    '2026-2': ['S2', 'Q3'],
  };
  
  // Filtrar por años
  if (selYears && selYears.length > 0) {
    filtered = filtered.filter(d => selYears.includes(d.ano ?? ''));
  }
  
  // Filtrar por períodos (mapear Excel periods a filter periods)
  if (selPeriodos && selPeriodos.length > 0) {
    filtered = filtered.filter(d => {
      const excelPeriod = d.periodo ?? '';
      const mappedPeriods = periodMap[excelPeriod] || [];
      return mappedPeriods.some(p => selPeriodos.includes(p));
    });
  }
  
  setVirtual2026S1(filtered);
}, [selYears, selPeriodos]);

  const clearAll = () => {
    setSelYears(["2026","2025","2024","2023","2022","2021","2020"]);
    setSelModalidades([]); setSelNiveles([]); setSelPeriodos([]); setSelCentros([]);
  };

  const marqueeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
<div className="h-screen bg-gray-100 flex flex-col overflow-hidden">

    {/* 🔥 HEADER LIMPIO */}
<header className="bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3">

  {/* LOGO */}
  <div className="flex items-center gap-3 min-w-0">
    <img 
      src="/Logo Bogotá 2.png"
      alt="Uniminuto"
      className="h-16 object-contain"
    />

    <div className="leading-tight truncate">
      <h1 className="text-sm font-bold text-gray-800">
        360 Resumen
      </h1>
      <p className="text-[10px] text-gray-500">
        UNIMINUTO • 2020–2026
      </p>
    </div>
  </div>

{/* 🔥 TABS CENTRADOS */}
  <div className="flex justify-center">
    <div className="flex flex-wrap gap-2">
      {["estudiantes","colaboradores","comparativos","oferta","investigacion"].map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-4 py-1.5 rounded-md text-xs capitalize transition ${
            activeTab === tab
              ? "bg-blue-600 text-white"
              : "bg-gray-100 hover:bg-gray-200"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  </div>

  {/* ACTIONS */}
  <div className="flex flex-wrap gap-3 w-full sm:w-auto">

    <button
      onClick={() => loadStudies(filters)}
      className="flex-1 sm:flex-none bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center gap-2 text-sm font-medium"
    >
      <RefreshCw size={18} /> Actualizar
    </button>

    <a
      href="https://uniminuto0.sharepoint.com/sites/G-360/SitePages/TrainingHome.aspx?csf=1&web=1&e=w2yk0v&CID=287406a8-213d-4da6-be63-fead9ee2fdc"
      target="_blank"
      className="flex-1 sm:flex-none bg-slate-800 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2"
    >
      <Gauge size={18} /> 360
    </a>

    <a
      href="https://uniminuto0.sharepoint.com/sites/G-360/SitePages/360-resumen.aspx?csf=1&web=1&e=uvj60w&CID=844a10d1-d452-41c3-9585-5e285da3d620"
      target="_blank"
      className="flex-1 sm:flex-none bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 shadow-md transition-all duration-200"
    >
      <Gauge size={18} /> Pareto
    </a>

  </div>

</header>

    {/* 🔥 TABS + FILTROS */}
<div className="bg-white border-b px-3 py-2 flex flex-col gap-2">

</div>

<div className="bg-slate-900 text-white text-xs overflow-hidden border-y">
  <div className="overflow-hidden">
    
    <div
      className="flex whitespace-nowrap animate-marquee"
      style={{
        animation: "marquee 30s linear infinite",
        width: "max-content"
      }}
    >
      {/* CONTENIDO */}
      <div className="flex">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="px-6">
            Sistema Integrado de Información · Corte: {fechaCorte}
          </span>
        ))}
      </div>

      {/* DUPLICADO */}
      <div className="flex">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={`dup-${i}`} className="px-6">
            Sistema Integrado de Información · Corte: {fechaCorte}
          </span>
        ))}
      </div>

    </div>
    
  </div>
</div>


    {/* 🔥 MAIN */}
<main className="flex-1 min-h-0 overflow-y-auto px-3 py-3">

      <div className="max-w-7xl mx-auto flex-1 min-h-0 flex flex-col gap-2">

        {/* 🔹 STATUS */}
        <div className="flex justify-between text-[11px]">
          {err && <span className="text-red-500">{err}</span>}
          {isLoading && <span className="text-gray-500">Cargando…</span>}
        </div>

        {/* 🔥 DASHBOARD */}
        <div className="flex-1 min-h-0 bg-white rounded-xl shadow-sm p-3 flex flex-col">

          {/* CONTENT */}
          <div className="flex-1 min-h-0">

{/* 🔥 TAB: ESTUDIANTES */}
{activeTab === "estudiantes" && (
  <div className="flex flex-col gap-3 h-full min-h-0">
    <DashboardCharts
  stats={stats}
  modalidadBreakdown={modalidadBreakdown}
  trend={trend}
  ausDes={ausDes}
  byCentro={byCentro}
  byEscuela={byEscuela}
  virtual2026S1={virtual2026S1}
  filtersComponent={
    <FiltersMulti
        years={base.years.map(y=>({label:y,value:y}))}
        modalidades={base.modalidades.map(m=>({label:m,value:m}))}
        niveles={base.niveles.map(n=>({label:n,value:n}))}
        periodos={base.periodos.map(p=>({label:p,value:p}))}
        centros={base.centros.map(c=>({label:c,value:c}))}
        selYears={selYears} setSelYears={setSelYears}
        selModalidades={selModalidades} setSelModalidades={setSelModalidades}
        selNiveles={selNiveles} setSelNiveles={setSelNiveles}
        selPeriodos={selPeriodos} setSelPeriodos={setSelPeriodos}
        selCentros={selCentros} setSelCentros={setSelCentros}
        clearAll={clearAll}
      />
  }
/>
  </div>
)}

            {/* 🔥 TAB: COLABORADORES */}
            {activeTab === "colaboradores" && (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                Dashboard de colaboradores (aquí conectas otros datos)
              </div>
            )}

            {/* 🔥 TAB: COMPARATIVOS */}
            {activeTab === "comparativos" && (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                Comparación entre años / centros / modalidades
              </div>
            )}

            {/* 🔥 TAB: OFERTA */}
            {activeTab === "oferta" && (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                Oferta académica / programas
              </div>
            )}

          </div>

        </div>

      </div>

    </main>

  </div>
);
}

export default App;
