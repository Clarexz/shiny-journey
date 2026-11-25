# Evaluaciones del extractor

Salida de `npm run eval:extractor` (plan, 13.2). Se corre antes de cambiar el prompt o el
modelo. Cada reporte dice el modelo, el esfuerzo de razonamiento, la versión del prompt, la
exactitud por campo, la latencia y el costo.

En una sesión de Claude Code en la nube, la key se inyecta por el proxy y el `fetch` de Node
necesita `NODE_USE_ENV_PROXY=1`:

```bash
NODE_USE_ENV_PROXY=1 OPENAI_API_KEY=proxy-injected npm run eval:extractor
```

## 2026-11-25: GPT-6 Luna, `reasoning_effort: "none"`, prompt v1 (T1.13)

Dos corridas de los 42 casos (`fixtures/eval/extractor-cases.json`), en serie:

| | Corrida 1 | Corrida 2 |
|---|---|---|
| Los tres campos correctos | 42 / 42 | 41 / 42 |
| Fallas de la llamada | 0 | 0 |
| Latencia p50 | 1013 ms | 1126 ms |
| Latencia p95 | 1628 ms | 2543 ms |
| Máxima | 1708 ms | 3158 ms |
| Por encima de 2000 ms | 0 | 5 |
| Costo de la corrida | US$0.0055 | US$0.0017 (caché de entrada) |
| Tokens por llamada | 1033 de entrada, 56 de salida, 0 de razonamiento | igual |

Conclusiones:

- **Exactitud.** Muy alta. El único error de las 84 llamadas fue "la próxima semana el
  martes", dicho un jueves: dio el martes de dentro de 19 días en vez del de dentro de 5, una
  fecha que habría pasado los filtros. Desde esta tarea, cuando el regex marca una expresión de
  fecha que no reconoce, la confianza final queda en 0.7 como máximo: esos casos van a
  NOTIFICAR. Ojo: los 5 mensajes reales también son los ejemplos del prompt, así que en esos 5
  la exactitud está inflada; las 37 variaciones no aparecen en el prompt.
- **Latencia.** Variable entre corridas: p95 de 1.6 s en una y de 2.5 s en otra. Con el tope de
  2000 ms, entre 0 % y 12 % de las llamadas al LLM terminarían en timeout y pasarían a
  NOTIFICAR. Como el LLM solo entra en unos 10 de cada 42 mensajes (24 %), eso es entre 0 % y
  3 % de todos los mensajes del grupo. Se deja el tope en 2000 ms y se mide en el modo
  observación (T1.25 y T1.30); si los timeouts pesan, se evalúa subirlo a 2500 ms dentro del
  presupuesto total de 3 s.
- **Costo.** Unos US$0.00004 a US$0.00013 por llamada: con 300 llamadas al mes, menos de
  US$0.04. El razonamiento en "none" no genera tokens de razonamiento.
