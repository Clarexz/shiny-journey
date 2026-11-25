# Evaluación del extractor: gpt-6-luna (razonamiento: none)

- Fecha: 2026-11-25
- Prompt: versión 1
- Casos: 42 (fixtures/eval/extractor-cases.json)
- Llamadas en serie, timeout de evaluación 15000 ms (el de producción es 2000 ms)

## Exactitud del LLM solo

| Campo | Correctos | Exactitud |
|---|---|---|
| Sucursal (número) | 42 / 42 | 100.0 % |
| Fechas | 42 / 42 | 100.0 % |
| Turno | 42 / 42 | 100.0 % |
| Los tres | 42 / 42 | 100.0 % |

Fallas de la llamada: ninguna.

## Exactitud del extractor combinado (lo que corre en producción)

El regex resuelve primero; el LLM solo entra en 10 de 42 casos.

| Campo | Correctos | Exactitud |
|---|---|---|
| Fechas | 42 / 42 | 100.0 % |
| Turno | 42 / 42 | 100.0 % |

## Latencia (ms, llamada completa)

| | Todas | Solo exitosas |
|---|---|---|
| p50 | 1013 | 1013 |
| p95 | 1628 | 1628 |
| Máxima | 1708 | 1708 |
| Por encima de 2000 ms | 0 de 42 | |

## Tokens y costo

- Promedio por llamada exitosa: 1033 de entrada, 56 de salida (0 de razonamiento).
- Costo total de la corrida: US$0.00551 (US$0.000131 por llamada).
- Proyección con 300 llamadas al mes: US$0.039.

## Diferencias del LLM con lo esperado

Ninguna.
