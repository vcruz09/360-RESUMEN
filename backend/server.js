// server.js (ESM)
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de Azure SQL
const config = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Pool de conexión
let pool;

// Conectar a Azure SQL
async function connectDB() {
  try {
    pool = await sql.connect(config);
    console.log('✅ Conectado exitosamente a Azure SQL Database (DB_APP)');
    console.log(`   Servidor: ${config.server}`);
    console.log(`   Base de datos: ${config.database}`);
  } catch (err) {
    console.error('❌ Error al conectar a Azure SQL:', getErrorMessage(err));
    process.exit(1);
  }
}

// Inicializar conexión
await connectDB();

// ==================== HELPERS ====================

// Normaliza texto: quita tildes, minúsculas, trim
const normalize = (s = '') =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

const findColumn = (cols, ...names) =>
  cols.find(c => names.some(name => normalize(c) === normalize(name)));

// Error seguro
function getErrorMessage(err) {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// Detecta el error de base pausada por límite gratuito
function isPausedDbError(err) {
  const msg = (getErrorMessage(err) || '').toLowerCase();
  return (
    msg.includes('monthly free amount allowance') ||
    msg.includes('paused for the remainder of the month') ||
    msg.includes('continue using database with additional charges')
  );
}

function sendPaused(res) {
  return res.status(503).json({
    errorCode: 'AZURE_SQL_PAUSED',
    message:
      'La base de datos Azure SQL está pausada por haber alcanzado el límite gratuito del mes. ' +
      'Puedes reanudarla en Azure Portal: SQL Database → Compute + storage → "Continue using database with additional charges". ' +
      'Se reanudará automáticamente el 01 del próximo mes (00:00 UTC).',
    docs: 'https://go.microsoft.com/fwlink/?linkid=2243105&clcid=0x409',
  });
}

// ==================== ENDPOINTS ====================

// Salud rápida
app.get('/api/health', async (_req, res) => {
  try {
    await pool.request().query('SELECT 1 AS ok');
    res.json({ status: 'ok', connected: true, timestamp: new Date().toISOString() });
  } catch (err) {
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ status: 'error', connected: false, error: getErrorMessage(err) });
  }
});

// Status amigable (intenta una consulta simple y te dice si está pausada)
app.get('/api/status', async (_req, res) => {
  try {
    const r = await pool.request().query('SELECT DB_NAME() AS db, SYSDATETIMEOFFSET() AS now');
    res.json({ paused: false, info: r.recordset?.[0] || null });
  } catch (err) {
    if (isPausedDbError(err)) {
      return res.status(503).json({
        paused: true,
        ...{
          errorCode: 'AZURE_SQL_PAUSED',
          message:
            'La base de datos está pausada por límite de consumo gratuito. Reanuda en Azure Portal: Compute + storage → Continue using database with additional charges.',
        },
      });
    }
    res.status(500).json({ paused: null, error: getErrorMessage(err) });
  }
});

// Tablas
app.get('/api/tablas', async (_req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    res.json(result.recordset);
  } catch (err) {
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// Estructura de tabla
app.get('/api/tablas/:nombre/estructura', async (req, res) => {
  try {
    const { nombre } = req.params;
    const result = await pool.request()
      .input('tableName', sql.NVarChar, nombre)
      .query(`
        SELECT COLUMN_NAME as columna, DATA_TYPE as tipo, IS_NULLABLE as nullable,
               CHARACTER_MAXIMUM_LENGTH as longitud
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION
      `);
    res.json(result.recordset);
  } catch (err) {
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// ===================== /api/datos/:tabla (paginado + filtros múltiples + orden Año DESC) =====================
app.get('/api/datos/:tabla', async (req, res) => {
  try {
    const AI = 'Latin1_General_CI_AI';
    const rawTabla = req.params.tabla;

    // Paginación
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50000, Math.max(100, Number(req.query.pageSize) || 1000));
    const offset = (page - 1) * pageSize;

    // Filtros múltiples: CSV
    const yearsCSV       = (req.query.years       ?? '').toString();   // ej "2026,2025"
    const modalidadesCSV = (req.query.modalidades ?? '').toString();
    const nivelesCSV     = (req.query.niveles     ?? '').toString();
    const periodosCSV    = (req.query.periodos    ?? '').toString();   // S1,S2,Q1...
    const centrosCSV     = (req.query.centros     ?? '').toString();

    // Tablas válidas (resuelve nombre real)
    const validTables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);
    let realTableName = null;
    for (const row of validTables.recordset) {
      if (normalize(row.TABLE_NAME) === normalize(rawTabla)) {
        realTableName = row.TABLE_NAME;
        break;
      }
    }
    if (!realTableName) {
      return res.status(404).json({ error: 'Tabla no encontrada', solicitada: rawTabla });
    }

    // Columnas (para ORDER)
    const cols = await pool.request()
      .input('t', sql.NVarChar, realTableName)
      .query(`
        SELECT COLUMN_NAME, ORDINAL_POSITION 
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @t
        ORDER BY ORDINAL_POSITION
      `);

    const colNames = cols.recordset.map(r => r.COLUMN_NAME);
    const nivelCol = findColumn(colNames, 'Nivel Académico');
    const hasAnyo = colNames.some(c => c.toLowerCase() === 'año' || c.toLowerCase() === 'ano');
    const orderByClause = hasAnyo ? 'ORDER BY [Año] DESC' : `ORDER BY [${cols.recordset[0]?.COLUMN_NAME || '1'}]`;

    // WHERE dinámico con listas CSV usando STRING_SPLIT
    const where = [];
    const reqData = pool.request();
    const reqCount = pool.request();
    where.push(`LOWER(LTRIM(RTRIM(Rectoría))) COLLATE Latin1_General_CI_AI = 'bogota'`);

    // Años: si no envían lista, restringe a 2020–2026
    if (yearsCSV) {
      reqData.input('years', sql.NVarChar, yearsCSV);
      reqCount.input('years', sql.NVarChar, yearsCSV);
      where.push(`[Año] IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@years, ','))`);
    } else {
      where.push(`[Año] BETWEEN 2020 AND 2026`);
    }

    // Modalidades
    if (modalidadesCSV) {
      reqData.input('mods', sql.NVarChar, modalidadesCSV);
      reqCount.input('mods', sql.NVarChar, modalidadesCSV);
      where.push(`Modalidad COLLATE ${AI} IN (
        SELECT value COLLATE ${AI} FROM STRING_SPLIT(@mods, ',')
      )`);
    }

    // Niveles
    if (nivelesCSV && nivelCol) {
      reqData.input('niv', sql.NVarChar, nivelesCSV);
      reqCount.input('niv', sql.NVarChar, nivelesCSV);
      where.push(`[${nivelCol}] COLLATE ${AI} IN (
        SELECT value COLLATE ${AI} FROM STRING_SPLIT(@niv, ',')
      )`);
    }

    // Centros
    if (centrosCSV) {
      reqData.input('cts', sql.NVarChar, centrosCSV);
      reqCount.input('cts', sql.NVarChar, centrosCSV);
      where.push(`[Centro Universitario] COLLATE ${AI} IN (
        SELECT value COLLATE ${AI} FROM STRING_SPLIT(@cts, ',')
      )`);
    }
    // Periodos (normalizados a S1/S2/Qx y comparados con la lista)
    if (periodosCSV) {
      reqData.input('pers', sql.NVarChar, periodosCSV.toUpperCase());
      reqCount.input('pers', sql.NVarChar, periodosCSV.toUpperCase());
      const periodCase = `
        (
          CASE
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S1','SEM1','1','01') THEN 'S1'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S2','SEM2','2','02') THEN 'S2'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q1','TRI1','TRIM1') THEN 'Q1'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q2','TRI2','TRIM2') THEN 'Q2'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q3','TRI3','TRIM3') THEN 'Q3'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-1'  THEN 'S1'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-01' THEN 'S1'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-2'  THEN 'S2'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-02' THEN 'S2'
            ELSE ''
          END
        ) IN (SELECT UPPER(value) FROM STRING_SPLIT(@pers, ','))
      `;
      where.push(periodCase);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const dataSql = `
      SELECT * FROM [${realTableName}]
      ${whereSql}
      ${orderByClause}
      OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
    `;
    const countSql = `
      SELECT COUNT(*) AS total FROM [${realTableName}] ${whereSql}
    `;

    const [dataR, countR] = await Promise.all([
      reqData.query(dataSql),
      reqCount.query(countSql),
    ]);

    res.json({
      page, pageSize,
      total: countR.recordset[0]?.total || 0,
      rows: dataR.recordset,
    });
  } catch (err) {
    console.error('Error /api/datos:', err);
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// Ejecutar SELECT custom (cuidado)
app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!/^\s*select\b/i.test(query)) {
      return res.status(403).json({ error: 'Solo se permiten consultas SELECT' });
    }
    const r = await pool.request().query(query);
    res.json(r.recordset);
  } catch (err) {
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// === /api/analytics: KPIs + categorías + tendencia con filtros (incluye CENTRO) ===
app.post('/api/analytics', async (req, res) => {
  const AI = 'Latin1_General_CI_AI';
  try {
    const {
      table = 'Poblacion Estudiantil',
      years,          // CSV: "2026,2025"
      modalidades,    // CSV
      niveles,        // CSV
      periodos,       // CSV: "S1,S2,Q1"
      centros         // CSV
    } = req.body || {};

    // Validar tabla
    const tables = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'
    `);
    const exists = tables.recordset.some(r => r.TABLE_NAME.toLowerCase() === String(table).toLowerCase());
    if (!exists) return res.status(400).json({ error: `Tabla no encontrada: ${table}` });

    const cols = await pool.request()
      .input('t', sql.NVarChar, String(table))
      .query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t`
      );
    const nivelCol = findColumn(cols.recordset.map(r => r.COLUMN_NAME), 'Nivel Académico') || 'Nivel Académico';

    const rq = pool.request();
    const where = [];
    where.push(`LOWER(LTRIM(RTRIM(Rectoría))) COLLATE Latin1_General_CI_AI = 'bogota'`);

    // Años (por defecto 2020–2026)
    if (years) {
      rq.input('years', sql.NVarChar, String(years));
      where.push(`[Año] IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@years, ','))`);
    } else {
      where.push(`[Año] BETWEEN 2020 AND 2026`);
    }

    if (modalidades) {
      rq.input('mods', sql.NVarChar, String(modalidades));
      where.push(`Modalidad COLLATE ${AI} IN (
        SELECT value COLLATE ${AI} FROM STRING_SPLIT(@mods, ',')
      )`);
    }
    if (niveles) {
      rq.input('niv', sql.NVarChar, String(niveles));
      where.push(`[${nivelCol}] COLLATE ${AI} IN (
        SELECT value COLLATE ${AI} FROM STRING_SPLIT(@niv, ',')
      )`);
    }
    if (centros) {
    rq.input('cts', sql.NVarChar, String(centros));
    where.push(`[Centro Universitario] COLLATE ${AI} IN (
      SELECT value COLLATE ${AI} FROM STRING_SPLIT(@cts, ',')
    )`);
  }
    
    if (periodos) {
      rq.input('pers', sql.NVarChar, String(periodos).toUpperCase());
      where.push(`
        (
          CASE
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S1','SEM1','1','01') THEN 'S1'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S2','SEM2','2','02') THEN 'S2'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q1','TRI1','TRIM1') THEN 'Q1'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q2','TRI2','TRIM2') THEN 'Q2'
            WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q3','TRI3','TRIM3') THEN 'Q3'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-1'  THEN 'S1'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-01' THEN 'S1'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-2'  THEN 'S2'
            WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-02' THEN 'S2'
            ELSE ''
          END
        ) IN (SELECT UPPER(value) FROM STRING_SPLIT(@pers, ','))
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // 🔥 Para virtuales: Bogotá, años, períodos, niveles, centros (SIN filtro de modalidad)
    const whereVirtual = [];
    whereVirtual.push(`LOWER(LTRIM(RTRIM(Rectoría))) COLLATE Latin1_General_CI_AI = 'bogota'`);
    if (years) {
      whereVirtual.push(`[Año] IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@years, ','))`);
    } else {
      whereVirtual.push(`[Año] BETWEEN 2020 AND 2026`);
    }
    if (niveles) {
      whereVirtual.push(`[${nivelCol}] COLLATE ${AI} IN (SELECT value COLLATE ${AI} FROM STRING_SPLIT(@niv, ','))`);
    }
    if (centros) {
      whereVirtual.push(`[Centro Universitario] COLLATE ${AI} IN (SELECT value COLLATE ${AI} FROM STRING_SPLIT(@cts, ','))`);
    }
    if (periodos) {
      whereVirtual.push(`(
        CASE
          WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S1','SEM1','1','01') THEN 'S1'
          WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('S2','SEM2','2','02') THEN 'S2'
          WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q1','TRI1','TRIM1') THEN 'Q1'
          WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q2','TRI2','TRIM2') THEN 'Q2'
          WHEN REPLACE(REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', ''), '-', '') IN ('Q3','TRI3','TRIM3') THEN 'Q3'
          WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-1'  THEN 'S1'
          WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-01' THEN 'S1'
          WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-2'  THEN 'S2'
          WHEN REPLACE(UPPER(CONVERT(NVARCHAR(30), [Periodo])), ' ', '') LIKE '%-02' THEN 'S2'
          ELSE ''
        END
      ) IN (SELECT UPPER(value) FROM STRING_SPLIT(@pers, ','))`);
    }
    const whereVirtualSql = whereVirtual.length ? `WHERE ${whereVirtual.join(' AND ')}` : '';

    // ===== ESTUDIOS =====
    const sqlText = `
      -- 1) KPIs
      SELECT
        SUM([Estudiantes Totales]) AS estudiantes,
        COUNT(DISTINCT [Centro Universitario]) AS centros,
        COUNT(DISTINCT Modalidad) AS modalidades,
        COUNT(DISTINCT [Programa Académico]) AS programas
      FROM [${table}] ${whereSql};

      -- 2) Modalidad + Nivel
      SELECT
        [${nivelCol}] AS nivelAcademico,
        Modalidad AS categoria,
        SUM([Estudiantes Nuevos])    AS nuevos,
        SUM([Estudiantes Continuos]) AS continuos,
        SUM([Estudiantes Totales])   AS totales
      FROM [${table}] ${whereSql}
      GROUP BY [${nivelCol}], Modalidad
      ORDER BY nivelAcademico, totales DESC;

      -- 3) Tendencia por Año (línea), restringida a 2020–2026 por definición
      SELECT
        CAST([Año] AS NVARCHAR(10)) AS fecha,
        SUM([Estudiantes Totales]) AS valor
      FROM [${table}]
      ${whereSql}
      GROUP BY [Año]
      HAVING MIN([Año]) BETWEEN 2020 AND 2026
      ORDER BY [Año];

      -- 4) Ausentismo/Deserción por Modalidad (barras comparativas)
      SELECT
        Modalidad AS modalidad,
        SUM([Ausentes (Periodo)])   AS ausentes,
        CASE WHEN SUM([Estudiantes Totales]) = 0 THEN 0
             ELSE (SUM([Ausentes (Periodo)])*100.0) / SUM([Estudiantes Totales]) END AS pct_ausentes,
        SUM([Desertores (Periodo)]) AS desertores,
        CASE WHEN SUM([Estudiantes Totales]) = 0 THEN 0
             ELSE (SUM([Desertores (Periodo)])*100.0) / SUM([Estudiantes Totales]) END AS pct_desertores
      FROM [${table}]
      ${whereSql}
      GROUP BY Modalidad
      ORDER BY modalidad;

      -- 5) Centro + Modalidad (estructura jerárquica real)
      SELECT
        [Centro Universitario] AS centro,
        [Centro de Operación] AS centroOperacion,
        Modalidad,
        SUM([Estudiantes Nuevos])    AS nuevos,
        SUM([Estudiantes Continuos]) AS continuos,
        SUM([Estudiantes Totales])   AS total
      FROM [${table}]
      ${whereSql}
      GROUP BY [Centro Universitario], [Centro de Operación], Modalidad
      ORDER BY centro, centroOperacion, total DESC;

      -- 6) Centro + Facultad (REAL)
      SELECT
        [Centro Universitario] AS centro,
        ISNULL(NULLIF(LTRIM(RTRIM([Centro de Operación])), ''), [Centro Universitario]) AS centroOperacion,
        [Facultad] AS escuela,
        SUM([Estudiantes Nuevos]) AS nuevos,
        SUM([Estudiantes Continuos]) AS continuos,
        SUM([Estudiantes Totales]) AS total
      FROM [${table}]
      ${whereSql}
      GROUP BY [Centro Universitario], [Centro de Operación], [Facultad]
      ORDER BY centro, total DESC;

      -- 7) Virtuales (INDEPENDIENTE: sin filtro de modalidad)
WITH Base AS (
  SELECT
    [${nivelCol}] AS nivelAcademico,
    SUM([Estudiantes Nuevos])    AS nuevos,
    SUM([Estudiantes Continuos]) AS continuos
  FROM [${table}]
  ${whereVirtualSql}
  GROUP BY [${nivelCol}]
)

SELECT
  nivelAcademico,
  'Nuevo' AS estado,
  SUM(nuevos) AS Bogota,
  SUM(nuevos) AS Total
FROM Base
GROUP BY nivelAcademico

UNION ALL

SELECT
  nivelAcademico,
  'Continuo' AS estado,
  SUM(continuos) AS Bogota,
  SUM(continuos) AS Total
FROM Base
GROUP BY nivelAcademico

ORDER BY nivelAcademico, estado;
    `;


    const result = await rq.query(sqlText);

// 🔹 RAW DATA
const rawCentro = result.recordsets?.[4] ?? [];
const rawEscuela = result.recordsets?.[5] ?? [];

// 🔹 Agrupar centros
const centroMap = new Map();

rawCentro.forEach(r => {
  const centro = r.centro;
  const op = r.centroOperacion ?? r["Centro de Operación"] ?? "Sin centro";

  // 🔹 NIVEL 1: CENTRO
  if (!centroMap.has(centro)) {
    centroMap.set(centro, {
      categoria: centro,
      nuevos: 0,
      continuos: 0,
      total: 0,
      operaciones: []
    });
  }

  const c = centroMap.get(centro);

  c.nuevos += Number(r.nuevos || 0);
  c.continuos += Number(r.continuos || 0);
  c.total += Number(r.total || 0);

  // 🔹 NIVEL 2: CENTRO OPERACIÓN
  let opNode = c.operaciones.find(o => o.nombre === op);

  if (!opNode) {
    opNode = {
      nombre: op,
      nuevos: 0,
      continuos: 0,
      total: 0,
      modalidades: []
    };
    c.operaciones.push(opNode);
  }

  opNode.nuevos += Number(r.nuevos || 0);
  opNode.continuos += Number(r.continuos || 0);
  opNode.total += Number(r.total || 0);

  // 🔹 NIVEL 3: MODALIDAD
  opNode.modalidades.push({
    modalidad: r.Modalidad ?? r.modalidad ?? "Sin modalidad",
    nuevos: Number(r.nuevos || 0),
    continuos: Number(r.continuos || 0),
    total: Number(r.total || 0)
  });
});

const byCentroFinal = Array.from(centroMap.values());

// 🔹 Facultades
const byEscuelaFinal = rawEscuela.map(r => ({
  centro: r.centro,
  centroOperacion: r.centroOperacion?.trim() || r.centro,
  escuela: r.escuela,
  nuevos: Number(r.nuevos || 0),
  continuos: Number(r.continuos || 0),
  total: Number(r.total || 0)
}));

// 🔥 RESPONSE FINAL
res.json({
  stats: result.recordsets?.[0]?.[0] ?? { estudiantes: 0, centros: 0, modalidades: 0, programas: 0 },
  modalidadBreakdown: result.recordsets?.[1] ?? [],
  trend: result.recordsets?.[2] ?? [],
  ausDes: result.recordsets?.[3] ?? [],
  byCentro: byCentroFinal,
  byEscuela: byEscuelaFinal,
  virtual2026S1: result.recordsets?.[6] ?? []
});

  } catch (err) {
    console.error('❌ Error /api/analytics:', err);
    if (isPausedDbError(err)) return sendPaused(res);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// Error global
app.use((err, _req, res, _next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);

  try {
    await connectDB();
  } catch (err) {
    console.error("Error conectando DB:", err);
  }
});

// Cierre limpio
process.on('SIGINT', async () => {
  console.log('\n👋 Cerrando conexión a Azure SQL...');
  try { await pool.close(); } catch {}
  process.exit(0);
});
