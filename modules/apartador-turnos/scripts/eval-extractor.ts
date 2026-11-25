/**
 * Evaluación del extractor contra la API real (plan, 13.2; T1.13).
 *
 *   OPENAI_API_KEY=... npm run eval:extractor
 *   OPENAI_API_KEY=... npm run eval:extractor -- --effort low --model gpt-6-luna --limit 10
 *
 * Manda cada caso de fixtures/eval/extractor-cases.json al LLM, uno por uno (para medir la
 * latencia sin colas), y reporta:
 * - exactitud por campo del LLM solo (sucursal, fechas, turno y los tres a la vez);
 * - exactitud del extractor combinado (regex primero, LLM solo cuando hace falta), que es lo
 *   que corre en producción;
 * - latencia p50, p95 y máxima, y cuántas llamadas pasarían el tope de producción (2 s);
 * - tokens y costo.
 * El reporte se guarda en docs/evals/. Los casos son sintéticos o ya públicos en el plan.
 *
 * En una sesión en la nube con la key inyectada por el proxy, el fetch de Node necesita
 * NODE_USE_ENV_PROXY=1 (ver docs/evals/README.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { LlmClient, LlmResult } from "@ravyn/core";
import { createOpenAiClient, type ReasoningEffort } from "@ravyn/llm";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { parseBranchesCsv } from "../src/catalog/branches";
import { BRANCHES_CSV_FILE } from "../src/catalog/sql";
import { BranchCatalog } from "../src/server/branch";
import { fmt, localDate } from "../src/server/dates";
import { extractDeterministic } from "../src/server/extract";
import { extractWithLlm, shouldCallLlm } from "../src/server/llm-extract";
import {
  LlmExtractionSchema,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  type LlmExtraction,
} from "../src/server/prompt";

const TZ = "America/Matamoros";
const PROD_TIMEOUT_MS = 2000;

const { values } = parseArgs({
  options: {
    model: { type: "string", default: process.env.LLM_MODEL ?? "gpt-6-luna" },
    effort: { type: "string", default: process.env.LLM_REASONING_EFFORT ?? "none" },
    limit: { type: "string" },
    timeout: { type: "string", default: "15000" },
    out: { type: "string" },
  },
});

interface EvalCase {
  id: string;
  text: string;
  at: string;
  expected: { numero: number; fechas: string[]; turno: string | null };
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { cases: allCases } = JSON.parse(
  readFileSync(new URL("../fixtures/eval/extractor-cases.json", import.meta.url), "utf8"),
) as { cases: EvalCase[] };
const cases = values.limit ? allCases.slice(0, Number(values.limit)) : allCases;
const catalog = new BranchCatalog(parseBranchesCsv(readFileSync(root + BRANCHES_CSV_FILE, "utf8")));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Falta OPENAI_API_KEY.");
  process.exit(1);
}
const client = createOpenAiClient({
  apiKey,
  model: values.model!,
  reasoningEffort: values.effort as ReasoningEffort,
  timeoutMs: Number(values.timeout),
  baseUrl: process.env.OPENAI_BASE_URL,
});

const sameDates = (a: string[], b: string[]) =>
  [...new Set(a)].sort().join() === [...new Set(b)].sort().join();
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)} %`);
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

interface Row {
  c: EvalCase;
  result: LlmResult<LlmExtraction>;
  llm: { numero: boolean; fechas: boolean; turno: boolean } | null;
  combined: { fechas: boolean; turno: boolean; usedLlm: boolean; failed: boolean };
}

const rows: Row[] = [];
for (const c of cases) {
  const now = new Date(c.at);
  const result = (await client.extractJson({
    schema: LlmExtractionSchema,
    name: "extraccion_cobertura",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(c.text, now, TZ),
  })) as LlmResult<LlmExtraction>;

  const llm = result.ok
    ? {
        numero: result.data.sucursal.numero === c.expected.numero,
        fechas: sameDates(result.data.fechas, c.expected.fechas),
        turno: result.data.turno === c.expected.turno,
      }
    : null;

  // Extractor combinado: reutiliza la misma respuesta (no hay una segunda llamada).
  const replay: LlmClient = { extractJson: async () => result as never };
  const det = extractDeterministic(c.text, now, {
    catalog,
    accepted: DOCTOR_ACCEPTED,
    timeZone: TZ,
  });
  const usedLlm = shouldCallLlm(det);
  const ex = usedLlm
    ? await extractWithLlm(det, c.text, now, {
        llm: replay,
        catalog,
        accepted: DOCTOR_ACCEPTED,
        timeZone: TZ,
        today: fmt(localDate(now, TZ)),
        maxDaysAhead: 60,
      })
    : det;
  rows.push({
    c,
    result,
    llm,
    combined: {
      fechas: sameDates(ex.dates, c.expected.fechas),
      turno: ex.shift === c.expected.turno,
      usedLlm,
      failed: ex.failed,
    },
  });
  const ms = result.usage.ms ?? 0;
  process.stderr.write(`${c.id}: ${result.ok ? "ok" : result.reason} ${ms} ms\n`);
}

// Métricas
const ok = rows.filter((r) => r.result.ok);
const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const latencies = rows.map((r) => r.result.usage.ms ?? 0);
const okLat = ok.map((r) => r.result.usage.ms ?? 0);
const cost = rows.reduce((s, r) => s + (r.result.usage.costUsd ?? 0), 0);
const avg = (f: (r: Row) => number) =>
  ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0;
const failures = rows
  .filter((r) => !r.result.ok)
  .map((r) => `${r.c.id} (${!r.result.ok ? r.result.reason : ""})`);
const combinedUsed = rows.filter((r) => r.combined.usedLlm);

const wrong = rows.flatMap((r) => {
  if (!r.result.ok || !r.llm) return [];
  const d = r.result.data;
  const out: string[] = [];
  if (!r.llm.numero)
    out.push(`| ${r.c.id} | sucursal | ${r.c.expected.numero} | ${d.sucursal.numero} |`);
  if (!r.llm.fechas)
    out.push(`| ${r.c.id} | fechas | ${r.c.expected.fechas.join(", ")} | ${d.fechas.join(", ")} |`);
  if (!r.llm.turno) out.push(`| ${r.c.id} | turno | ${r.c.expected.turno} | ${d.turno} |`);
  return out;
});

const date = new Date().toISOString().slice(0, 10);
const report = `# Evaluación del extractor: ${values.model} (razonamiento: ${values.effort})

- Fecha: ${date}
- Prompt: versión ${PROMPT_VERSION}
- Casos: ${rows.length} (fixtures/eval/extractor-cases.json)
- Llamadas en serie, timeout de evaluación ${values.timeout} ms (el de producción es ${PROD_TIMEOUT_MS} ms)

## Exactitud del LLM solo

| Campo | Correctos | Exactitud |
|---|---|---|
| Sucursal (número) | ${count((r) => !!r.llm?.numero)} / ${rows.length} | ${pct(
  count((r) => !!r.llm?.numero),
  rows.length,
)} |
| Fechas | ${count((r) => !!r.llm?.fechas)} / ${rows.length} | ${pct(
  count((r) => !!r.llm?.fechas),
  rows.length,
)} |
| Turno | ${count((r) => !!r.llm?.turno)} / ${rows.length} | ${pct(
  count((r) => !!r.llm?.turno),
  rows.length,
)} |
| Los tres | ${count((r) => !!r.llm && r.llm.numero && r.llm.fechas && r.llm.turno)} / ${rows.length} | ${pct(
  count((r) => !!r.llm && r.llm.numero && r.llm.fechas && r.llm.turno),
  rows.length,
)} |

Fallas de la llamada: ${failures.length === 0 ? "ninguna" : failures.join(", ")}.

## Exactitud del extractor combinado (lo que corre en producción)

El regex resuelve primero; el LLM solo entra en ${combinedUsed.length} de ${rows.length} casos.

| Campo | Correctos | Exactitud |
|---|---|---|
| Fechas | ${count((r) => r.combined.fechas)} / ${rows.length} | ${pct(
  count((r) => r.combined.fechas),
  rows.length,
)} |
| Turno | ${count((r) => r.combined.turno)} / ${rows.length} | ${pct(
  count((r) => r.combined.turno),
  rows.length,
)} |

## Latencia (ms, llamada completa)

| | Todas | Solo exitosas |
|---|---|---|
| p50 | ${quantile(latencies, 0.5)} | ${quantile(okLat, 0.5)} |
| p95 | ${quantile(latencies, 0.95)} | ${quantile(okLat, 0.95)} |
| Máxima | ${Math.max(...latencies)} | ${okLat.length ? Math.max(...okLat) : "-"} |
| Por encima de ${PROD_TIMEOUT_MS} ms | ${latencies.filter((x) => x > PROD_TIMEOUT_MS).length} de ${latencies.length} | |

## Tokens y costo

- Promedio por llamada exitosa: ${avg((r) => r.result.usage.inputTokens ?? 0).toFixed(0)} de entrada, ${avg((r) => r.result.usage.outputTokens ?? 0).toFixed(0)} de salida (${avg((r) => r.result.usage.reasoningTokens ?? 0).toFixed(0)} de razonamiento).
- Costo total de la corrida: US$${cost.toFixed(5)} (US$${(cost / Math.max(1, rows.length)).toFixed(6)} por llamada).
- Proyección con 300 llamadas al mes: US$${((cost / Math.max(1, rows.length)) * 300).toFixed(3)}.

## Diferencias del LLM con lo esperado

${wrong.length === 0 ? "Ninguna." : `| Caso | Campo | Esperado | LLM |\n|---|---|---|---|\n${wrong.join("\n")}`}
`;

const out = values.out ?? `${root}docs/evals/${date}-${values.model}-${values.effort}.md`;
mkdirSync(fileURLToPath(new URL(".", `file://${out}`)), { recursive: true });
writeFileSync(out, report);
console.warn(`\n${report}\nReporte: ${out}`);
