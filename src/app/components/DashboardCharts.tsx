// src/components/DashboardCharts.tsx
import { useState } from "react";

export interface DashboardChartsProps {
  stats: {
    estudiantes?: number;
    centros?: number;
    modalidades?: number;
    programas?: number;
  } | null;
  modalidadBreakdown: {
    nivelAcademico: string;
    categoria: string;
    nuevos: number;
    continuos: number;
    totales: number;
  }[];
  trend: { fecha: string; valor: number }[];
  ausDes: {
    modalidad: string;
    ausentes: number;
    pct_ausentes: number;
    desertores: number;
    pct_desertores: number;
    total: number;
  }[];
  // byCentro.categoria = nombre del Centro Universitario
    // 🔥 FIX REAL AQUÍ
byCentro: {
  categoria: string;
  nuevos: number;
  continuos: number;
  total: number;
  operaciones?: {
    nombre: string;
    nuevos: number;
    continuos: number;
    total: number;
    modalidades?: {
      modalidad: string;
      nuevos: number;
      continuos: number;
      total: number;
    }[];
  }[];
}[];
  // byEscuela.escuela = nombre de Facultad (FCCO, FCEM, etc.)
  byEscuela: {
  centro: string;
  centroOperacion: string; 
  escuela: string;
  total: number;
}[];
  virtual2026S1: {
    estado: string;
    nivelAcademico: string; // 🔥 AGREGA ESTO
    Bogota: number;
    Total: number;
  }[];

  filtersComponent?: React.ReactNode;
}

const numFmt = (v: unknown) => Number(v ?? 0).toLocaleString("es-CO");

const pctColor = (p: number) => {
  if (p > 15) return "#c0392b";
  if (p > 10) return "#e67e22";
  return "#27ae60";
};

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      border: "1px solid #b0bbd8",
      borderRadius: 3,
      display: "flex",
      flexDirection: "column",
      minHeight: 0,   // 🔥 CLAVE
      minWidth: 0,
      height: "100%",
      ...style
    }}>
      <div style={{
        backgroundColor: "#1a3a6b",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        padding: "4px 8px",
        textAlign: "center",
        flexShrink: 0
      }}>
        {title}
      </div>

      <div style={{
        flex: 1,
        minHeight: 0
      }}>
        {children}
      </div>
    </div>
  );
}


function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr style={{ backgroundColor: "#1a3a6b", color: "#fff", fontSize: 10 }}>
        {cols.map((c, i) => (
          <th key={i} style={{ padding: "4px 6px", textAlign: i === 0 ? "left" : "right", fontWeight: 600, whiteSpace: "nowrap", borderRight: i < cols.length - 1 ? "1px solid #2a4f9b" : undefined }}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TreeRow({ label, cols, depth = 0, children, defaultOpen = false }: { label: string; cols: (string | number)[]; depth?: number; children?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasKids = Array.isArray(children)
  ? children.length > 0
  : !!children;
  const bg = depth === 0 ? "#dce8fb" : depth === 1 ? "#eef3fd" : "#f9fafe";
  const fw = depth === 0 ? 700 : depth === 1 ? 600 : 400;
  return (
    <>
      <tr style={{ backgroundColor: bg, fontWeight: fw, fontSize: 11 }}>
        <td style={{ padding: "3px 4px 3px " + (depth * 14 + 6) + "px", borderBottom: "1px solid #dde3ee", whiteSpace: "nowrap", cursor: hasKids ? "pointer" : "default", userSelect: "none" }} onClick={() => hasKids && setOpen(o => !o)}>
          {hasKids && <span style={{ marginRight: 4, fontSize: 9, color: "#1a3a6b" }}>{open ? "▼" : "▶"}</span>}
          {!hasKids && depth > 0 && <span style={{ marginRight: 4, fontSize: 9, color: "#aaa" }}>⬩</span>}
          {label}
        </td>
        {cols.map((c, i) => (
          <td key={i} style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid #dde3ee", whiteSpace: "nowrap" }}>
            {typeof c === "number" ? numFmt(c) : c}
          </td>
        ))}
      </tr>
      {open && children}
    </>
  );
}

function TotalRow({ label, cols }: { label: string; cols: (string | number)[] }) {
  return (
    <tr style={{ backgroundColor: "#dce8fb", fontWeight: 700, fontSize: 11 }}>
      <td style={{ padding: "3px 6px", borderTop: "2px solid #1a3a6b" }}>{label}</td>
      {cols.map((c, i) => (
        <td key={i} style={{ padding: "3px 6px", textAlign: "right", borderTop: "2px solid #1a3a6b" }}>
          {typeof c === "number" ? numFmt(c) : c}
        </td>
      ))}
    </tr>
  );
}

function TableScroll({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      overflowX: "auto",
      overflowY: "auto",
      minWidth: 0,          // 🔥 CRÍTICO
      maxWidth: "100%",     // 🔥 EVITA que se salga
      WebkitOverflowScrolling: "touch"
    }}>
      {children}
    </div>
  );
}

export function DashboardCharts({ stats, modalidadBreakdown, ausDes, byCentro, byEscuela, virtual2026S1, filtersComponent }: DashboardChartsProps) {
  const totalEst = stats?.estudiantes ?? 0;const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// 🔥 NUEVO: normalizar nivel académico

const normalizeNivel = (nivel: string) => {
  const n = (nivel || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (!n) return "Pregrado";

  // 🔥 POSGRADO (más completo)
  if (
    n.includes("posgrado") ||
    n.includes("posgr") ||
    n.includes("especial") ||
    n.includes("maestr") ||
    n.includes("doctor") ||
    n.includes("phd")
  ) return "Posgrado";

  // 🔥 PREGRADO explícito
  if (
    n.includes("pregrado") ||
    n.includes("tecnolog") ||
    n.includes("profesional")
  ) return "Pregrado";

  // 🔥 fallback inteligente
  return "Pregrado";
};

type NivelRow = {
  nivelAcademico: string;
  nuevos: number;
  continuos: number;
  totales: number;
  mods: typeof modalidadBreakdown;
};

// 🔥 inicializar SIEMPRE ambos
const nivelMap = new Map<string, NivelRow>([
  ["Pregrado", { nivelAcademico: "Pregrado", nuevos: 0, continuos: 0, totales: 0, mods: [] }],
  ["Posgrado", { nivelAcademico: "Posgrado", nuevos: 0, continuos: 0, totales: 0, mods: [] }],
]);

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

modalidadBreakdown.forEach(d => {
  const nivel = normalizeNivel(d.nivelAcademico);
  const n = nivelMap.get(nivel);

if (!n) {
  console.warn("Nivel no reconocido:", d.nivelAcademico, "→", nivel);
  return;
}

  if (!d) return;

  n.nuevos += Number(d.nuevos || 0);
  n.continuos += Number(d.continuos || 0);
  n.totales += Number(d.totales || 0);

  const key = normalize(d.categoria);

  let existing = n.mods.find(m => normalize(m.categoria) === key);

  if (!existing) {
    n.mods.push({
      categoria: d.categoria,
      nuevos: Number(d.nuevos || 0),
      continuos: Number(d.continuos || 0),
      totales: Number(d.totales || 0),
      nivelAcademico: nivel,
    });
  } else {
    existing.nuevos += Number(d.nuevos || 0);
    existing.continuos += Number(d.continuos || 0);
    existing.totales += Number(d.totales || 0);
  }
});

const nivelRows = Array.from(nivelMap.values())
  .filter(n => n.totales > 0);


  nivelRows.forEach(n => {
  const map = new Map();

  n.mods.forEach(m => {
    const key = normalize(m.categoria);

    if (!map.has(key)) {
      map.set(key, { ...m });
    } else {
      const mm = map.get(key);
      mm.nuevos += m.nuevos;
      mm.continuos += m.continuos;
      mm.totales += m.totales;
    }
  });

  n.mods = Array.from(map.values());
});

  const totalNuevos = nivelRows.reduce((s, n) => s + n.nuevos, 0);
  const totalContinuos = nivelRows.reduce((s, n) => s + n.continuos, 0);
  const totalTotales = nivelRows.reduce((s, n) => s + n.totales, 0);

  // CENTROS — de byCentro
const centros = byCentro.map(c => ({
  nombre: c.categoria,
  nuevos: Number(c.nuevos || 0),
  continuos: Number(c.continuos || 0),
  total: Number(c.total || 0),

  operaciones: (c.operaciones || []).map(o => ({
    nombre: o.nombre,
    nuevos: Number(o.nuevos || 0),
    continuos: Number(o.continuos || 0),
    total: Number(o.total || 0),

    mods: (o.modalidades || []).map(m => ({
      nombre: m.modalidad,
      nuevos: Number(m.nuevos || 0),
      continuos: Number(m.continuos || 0),
      total: Number(m.total || 0),
    }))
  }))
}));

centros.forEach(c => {
  c.operaciones.forEach(o => {
    const map = new Map();

    o.mods.forEach(m => {
      const key = normalize(m.nombre);

      if (!map.has(key)) {
        map.set(key, { ...m });
      } else {
        const mm = map.get(key);
        mm.nuevos += m.nuevos;
        mm.continuos += m.continuos;
        mm.total += m.total;
      }
    });

    o.mods = Array.from(map.values());
  });
});
  const totalCentroTotal = centros.reduce((s, c) => s + c.total, 0);
  const totalCentroNuevos = centros.reduce((s, c) => s + c.nuevos, 0);
  const totalCentroCont = centros.reduce((s, c) => s + c.continuos, 0);



  const facCols = Array.from(
  new Set(byEscuela.map(f => f.escuela))
);

const totalFacultades: Record<string, number> = {};

facCols.forEach(f => totalFacultades[f] = 0);

byEscuela.forEach(f => {
  totalFacultades[f.escuela] += f.total;
});
  // FACULTADES — de byEscuela
  // 🔥 Agrupar facultades por centro
const facMap = new Map<
  string,
  Map<string, { nombre: string; facs: Map<string, number> }>
>();

centros.forEach(c => {
  const centroKey = normalize(c.nombre);

  if (!facMap.has(centroKey)) {
    facMap.set(centroKey, new Map());
  }

  const opMap = facMap.get(centroKey)!;

  c.operaciones.forEach(o => {
    const opKey = normalize(o.nombre);

    if (!opMap.has(opKey)) {
  opMap.set(opKey, {
    nombre: o.nombre, // ✅ CON TILDES
    facs: new Map()
  });
}
  });
});

// 🔥 ahora sí llenar con facultades
byEscuela.forEach(f => {
  const centroKey = normalize(f.centro);
  const opKey = f.centroOperacion?.trim()
    ? normalize(f.centroOperacion)
    : "sin_operacion_real";

  const opMap = facMap.get(centroKey);
  if (!opMap) return;

  if (!opMap.has(opKey)) {
    opMap.set(opKey, {
      nombre: f.centroOperacion || "sin_operacion_real",
      facs: new Map()
    });
  }

const entry = opMap.get(opKey)!;
const facs = entry.facs;

  facs.set(
    f.escuela,
    (facs.get(f.escuela) || 0) + Number(f.total || 0)
  );
});
  
  // Ausentismo
  const totalAus = ausDes.reduce((s, d) => s + d.ausentes, 0);
  const totalDes = ausDes.reduce((s, d) => s + d.desertores, 0);
  const pctAusTotal = totalEst > 0
  ? (totalAus * 100) / totalEst
  : 0;
  const pctDesTotal = totalEst > 0
  ? (totalDes * 100) / totalEst
  : 0;

const virtualTree = new Map<
  string,
  {
    estado: string;
    total: number;
    niveles: Map<string, number>;
  }
>();

virtual2026S1.forEach(d => {
  const estado = d.estado;
  const nivel = normalizeNivel(d.nivelAcademico);
  const valor = Number(d.Bogota || 0);

  if (!virtualTree.has(estado)) {
    virtualTree.set(estado, {
      estado,
      total: 0,
      niveles: new Map()
    });
  }

  const node = virtualTree.get(estado)!;

  node.total += valor;

  node.niveles.set(
    nivel,
    (node.niveles.get(nivel) || 0) + valor
  );
});

const virtualRows = Array.from(virtualTree.values());

  const tStyle: React.CSSProperties = { 
  width: "max-content",
  borderCollapse: "collapse", 
  fontSize: 11, 
  fontFamily: "'Segoe UI', Arial, sans-serif",
  minWidth: "100%"   // 🔥 AQUÍ lo agregas
};
return (
<div style={{
  display: "grid",
  gridTemplateRows: "auto auto 1fr",
  gap: 8,
  height: "auto"
}}>

    {/* 🔹 ROW 1 → KPI + FILTROS */}
    <div style={{
      display: "grid",
      gridTemplateColumns: "160px 1fr",
      gap: 8
    }}>
      <Panel title="Estudiantes Totales">
         <TableScroll>
      <div style={{ overflowX: "auto" }}>
        <div style={{
          fontSize: 32,
          fontWeight: 800,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          {numFmt(totalEst)}
        </div>
        </div>
        </TableScroll>
      </Panel>

      <Panel title="Filtros">
      
        {filtersComponent}
      
      </Panel>
    </div>

{/* 🔹 ROW 2 */}
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: 8,
      alignItems: "start",
      minHeight: 0
    }}>

    <Panel title="Estudiantes por Modalidad"> 
              <TableScroll>
          <div style={{ overflowX: "auto" }}>
        <table style={tStyle}>
          <THead cols={["Nivel Académico", "Nuevos", "Continuos", "Totales"]} />
          <tbody>
            {nivelRows.map((n, idx) => (
              <TreeRow
                key={idx}
                label={`${idx + 1}. ${n.nivelAcademico}`}
                cols={[n.nuevos, n.continuos, n.totales]}
                defaultOpen
              >
                {n.mods.map((m, j) => (
                  <TreeRow key={j} label={m.categoria} cols={[m.nuevos, m.continuos, m.totales]} depth={1} />
                ))}
              </TreeRow>
            ))}
            <TotalRow label="Total" cols={[totalNuevos, totalContinuos, totalTotales]} />
          </tbody>
        </table>
        </div>
        </TableScroll>
      </Panel>

            {/* 🟨 DERECHA (AUS + VIRTUAL) */}
      <div style={{
        display: "grid",
        gridAutoRows: "min-content",
        gap: 6,
        minHeight: 0 
      }}>
      <Panel title="Ausentismo y Deserción">
        <TableScroll>
      <table style={tStyle}>
          <THead cols={["Modalidad", "Ausentes", "%", "Desertores", "%"]} />
          <tbody>
            {ausDes.map((d, i) => {
              const pctAus = d.pct_ausentes;
              const pctDes = d.pct_desertores;

              return (
                <tr key={i}>
                  <td style={{ padding: "3px 6px" }}>{i + 1}. {d.modalidad}</td>
                  <td style={{ textAlign: "right" }}>{numFmt(d.ausentes)}</td>
                  <td style={{ textAlign: "right", color: pctColor(pctAus) }}>
                    {pctAus.toFixed(2)} %
                  </td>
                  <td style={{ textAlign: "right" }}>{numFmt(d.desertores)}</td>
                  <td style={{ textAlign: "right", color: pctColor(pctDes) }}>
                    {pctDes.toFixed(2)} %
                  </td>
                </tr>
              );
            })}

            <tr style={{ fontWeight: 700, backgroundColor: "#dce8fb" }}>
  <td style={{ padding: "3px 6px", borderTop: "2px solid #1a3a6b" }}>
    Total
  </td>

  <td style={{ textAlign: "right", borderTop: "2px solid #1a3a6b" }}>
    {numFmt(totalAus)}
  </td>

  <td style={{
    textAlign: "right",
    color: pctColor(pctAusTotal),
    borderTop: "2px solid #1a3a6b"
  }}>
    {pctAusTotal.toFixed(2)} %
  </td>

  <td style={{ textAlign: "right", borderTop: "2px solid #1a3a6b" }}>
    {numFmt(totalDes)}
  </td>

  <td style={{
    textAlign: "right",
    color: pctColor(pctDesTotal),
    borderTop: "2px solid #1a3a6b"
  }}>
    {pctDesTotal.toFixed(2)} %
  </td>
</tr>
          </tbody>
        </table>
        </TableScroll>
      </Panel>

      {/* 🔹 VIRTUAL */}
<Panel title="Estudiantes Virtuales">
  <TableScroll>
    <table style={tStyle}>
      <THead cols={["Estado", "Cantidad"]} />
      <tbody>

        {virtualRows.map((node, i) => (
          <TreeRow
            key={i}
            label={`${i + 1}. ${node.estado}`}
            cols={[node.total]}
            defaultOpen
          >
            {Array.from(node.niveles.entries()).map(([nivel, valor], j) => (
              <TreeRow
                key={j}
                label={nivel}
                cols={[valor]}
                depth={1}
              />
            ))}
          </TreeRow>
        ))}

        <TotalRow
          label="Total"
          cols={[
            virtualRows.reduce((s, r) => s + r.total, 0)
          ]}
        />

      </tbody>
    </table>
  </TableScroll>
</Panel>
</div>
    </div>

    {/* 🔥 ROW 3 */}
<div style={{
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: 8,
  minHeight: 0     // 🔥 CLAVE OCULTA
}}>
        {/* ✅ CENTROS — usa byCentro */}
        <Panel title="Estudiantes por Centro Universitario y Modalidad">
                    <TableScroll>
          <div style={{ overflowX: "auto" }}>
            <div style={{ maxHeight: "375px", overflowY: "auto" }}>
          <table style={tStyle}>
            <THead cols={["Centro Universitario", "Nuevos", "Continuos", "Totales"]} />
         <tbody>
                {centros.map((c, i) => (
  <TreeRow
    key={i}
    label={c.nombre}
    cols={[c.nuevos, c.continuos, c.total]}
    defaultOpen
  >
    {c.operaciones?.map((o: any, j: number) => (
      <TreeRow
        key={j}
        label={"- " + o.nombre}
        cols={[o.nuevos, o.continuos, o.total]}
        depth={1}
        defaultOpen
      >
        {o.mods?.map((m: any, k: number) => (
          <TreeRow
            key={k}
            label={m.nombre}
            cols={[m.nuevos, m.continuos, m.total]}
            depth={2}
            defaultOpen
          />
        ))}
      </TreeRow>
    ))}
  </TreeRow>
))}

                {/* 🔥 TOTAL FUERA DEL MAP */}
                <TotalRow
                  label="Total"
                  cols={[
                    Number(totalCentroNuevos || 0),
                    Number(totalCentroCont || 0),
                    Number(totalCentroTotal || 0)
                  ]}
                />
              </tbody>
          </table>
          </div>
          </div>
          </TableScroll>
        </Panel>

        {/* ✅ FACULTADES — usa byEscuela */}
        <Panel title="Estudiantes por Facultad">
           <TableScroll>
          <div style={{ overflowX: "auto" }}>
          <div style={{ maxHeight: "375px", overflowY: "auto" }}>
          <table style={tStyle}>
            <THead cols={["Centro Universitario", ...facCols, "Total"]} />
<tbody>
{centros.map((c, i) => {
  const opMap = facMap.get(normalize(c.nombre)) || new Map();

  const operacionesCentro = (c.operaciones || []).map(o =>
  normalize(o.nombre.trim())
);

  return ( // ✅ IMPORTANTE
    <TreeRow
      key={i}
      label={c.nombre}
      cols={[
        ...facCols.map(f => {
          let total = 0;
        opMap.forEach(entry => {
          total += entry.facs.get(f) || 0;
        });

          return total;
        }),
        c.total
      ]}
      defaultOpen
    >
      {Array.from(opMap.entries())
        .filter(([op]) =>
          operacionesCentro.some(o => o === normalize(op))
        )
        .map(([op, entry], j) => {
          const facs = entry.facs;
          const totalOp = Array.from(facs.values())
            .reduce((a, b) => Number(a) + Number(b), 0);
          return (
            <TreeRow
              key={j}
              label={entry.nombre}
              depth={1}
              cols={[
                ...facCols.map(f => facs.get(f) || 0),
                totalOp
              ]}
            />
          );
        })}
    </TreeRow>
  );
})}

  {/* TOTAL GENERAL */}
  <TotalRow
    label="Total"
    cols={[
      ...facCols.map(f => totalFacultades[f]),
      Object.values(totalFacultades)
  .reduce((a: number, b: number) => a + b, 0)
    ]}
  />
</tbody>
          </table>
          </div>
          </div>
          </TableScroll>
        </Panel>
        </div>
      </div>
  );
}

