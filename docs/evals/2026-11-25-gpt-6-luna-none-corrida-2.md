# Evaluación del extractor: gpt-6-luna (razonamiento: none)

- Fecha: 2026-11-25
- Prompt: versión 1
- Casos: 42 (fixtures/eval/extractor-cases.json)
- Llamadas en serie, timeout de evaluación 15000 ms (el de producción es 2000 ms)

## Exactitud del LLM solo

| Campo | Correctos | Exactitud |
|---|---|---|
| Sucursal (número) | 42 / 42 | 100.0 % |
| Fechas | 41 / 42 | 97.6 % |
| Turno | 42 / 42 | 100.0 % |
| Los tres | 41 / 42 | 97.6 % |

Fallas de la llamada: ninguna.

## Exactitud del extractor combinado (lo que corre en producción)

El regex resuelve primero; el LLM solo entra en 10 de 42 casos.

| Campo | Correctos | Exactitud |
|---|---|---|
| Fechas | 41 / 42 | 97.6 % |
| Turno | 42 / 42 | 100.0 % |

## Latencia (ms, llamada completa)

| | Todas | Solo exitosas |
|---|---|---|
| p50 | 1126 | 1126 |
| p95 | 2543 | 2543 |
| Máxima | 3158 | 3158 |
| Por encima de 2000 ms | 5 de 42 | |

## Tokens y costo

- Promedio por llamada exitosa: 1033 de entrada, 56 de salida (0 de razonamiento).
- Costo total de la corrida: US$0.00170 (US$0.000041 por llamada).
- Proyección con 300 llamadas al mes: US$0.012.

## Diferencias del LLM con lo esperado

| Caso | Campo | Esperado | LLM |
|---|---|---|---|
| proxima-semana-martes | fechas | 2026-11-17 | 2026-12-01 |
