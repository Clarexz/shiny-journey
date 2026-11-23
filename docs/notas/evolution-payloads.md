# Evolution API: payloads reales y `@lid` (T1.5 y T1.6)

Captura hecha el 2026-11-23 en el VPS, con números de prueba de Ravyn (A vinculado a Evolution,
B escribiendo) y un grupo de prueba. Ningún número de cliente. Los fixtures anonimizados están en
`modules/apartador-turnos/fixtures/evolution/` y se prueban en
`packages/channels/src/evolution/real-fixtures.test.ts`.

Valores falsos de los fixtures: A = `5218990000001`, B = `5218990000002`, un tercero del grupo =
`5218990000003`; LID de A `100000000000001`, del tercero `100000000000002` y de B
`100000000000003`; grupo `120363000000000001@g.us`; ids `3EB0FAKE…`.

## Versión fijada

`EVOLUTION_VERSION=v2.3.7` (`evoapicloud/evolution-api`, publicada el 2025-12-05; es la última de
la serie 2.3 en Docker Hub). Razones:

- Trae Baileys 7.0.0-rc.9 y varias correcciones de `@lid` (filtro con `remoteJidAlt`, mensajes
  `@lid` que se perdían por *stubs*).
- Corrige que `DATABASE_SAVE_DATA_CONTACTS=false` no se respetara al actualizar contactos.
- Corrige la pérdida de eventos de mensajes después de reconectar y el estado "esperando mensaje"
  tras reconectar (Redis con llaves viejas). Las dos cosas importan con la sesión del doctor.

WhatsApp Web reportado por la API: `2.3000.1055826538`.

## Rutas y cuerpos (lo que acepta v2.3.7 en vivo)

| Llamada | Resultado | ¿Coincide con `adapter.ts`? |
|---|---|---|
| `POST /instance/create` `{instanceName, integration: "WHATSAPP-BAILEYS", qrcode: false}` | 201. Responde `instance`, `hash` (token de la instancia) y `settings` | sí |
| `POST /instance/create` repetido | **403** `This name "…" is already in use.` | sí (`isInstanceAlreadyExists` trata 403) |
| `POST /webhook/set/{i}` con el cuerpo **envuelto** en `webhook` | 201 | sí |
| `POST /webhook/set/{i}` sin envolver | 400 `instance requires property "webhook"` | — |
| `webhook.headers` | se acepta, se guarda y llega en cada webhook (`x-ravyn-webhook-token`) | sí |
| `POST /settings/set/{i}` con los 6 booleanos | 201. `rejectCall`, `groupsIgnore`, `alwaysOnline`, `readMessages`, `readStatus` y `syncFullHistory` son **obligatorios** | sí (`EVOLUTION_INSTANCE_SETTINGS` los trae todos) |
| `POST /instance/restart/{i}` | es POST; `PUT` da 404 | sí |
| `GET /instance/connect/{i}?number=521…` | 200 `{pairingCode, code, base64, count}` | sí |
| `GET /instance/connectionState/{i}` | `{instance: {instanceName, state}}` | sí |
| `GET /group/participants/{i}?groupJid=…` | `{participants: [{id: "<lid>@lid", phoneNumber: "521…@s.whatsapp.net", admin}]}` | sí (fixture `api-group-participants.json`) |
| `GET /group/fetchAllGroups/{i}?getParticipants=false` | arreglo con `id`, `subject`, `size`, `owner`, `desc`, etc. | sí |
| `POST /chat/whatsappNumbers/{i}` `{numbers: [...]}` | `[{jid, exists, number, lid}]`; `521…` y `52…` devuelven el mismo `jid` con `521` | — (fixture `api-whatsapp-numbers.json`; `lid` trae el texto literal `"lid"`, no el LID) |

## Sobre del webhook

```
{ event, instance, data, destination, date_time, sender, server_url, apikey }
```

- `event` en minúsculas con punto (`messages.upsert`).
- `sender` es el JID **propio de la instancia** (`521…@s.whatsapp.net`), no el autor del mensaje.
- `apikey` es el token de la instancia (`hash`): el worker nunca debe registrarlo.
- `connection.update`: `data = {instance, state, statusReason}`. Con `open` agrega `wuid` (JID
  propio) y `profilePictureUrl`. Llegó `connecting` dos veces con `statusReason: 200` y luego
  `open` con 200.
- `qrcode.updated`: `data.qrcode = {instance, pairingCode, code, base64}` (con código de
  vinculación, `pairingCode` también viene aquí).

## `messages.upsert` y `@lid`

- `data` es un objeto (un mensaje por webhook). `messageTimestamp` es un número en segundos.
- Todos los mensajes llegan con `key.addressingMode: "lid"`, incluso los DM.
- **Grupo**: `key.participant` siempre es `@lid`, para todos (también para B, que tiene a A en
  sus contactos). El teléfono viene en **`key.participantAlt`** (`521…@s.whatsapp.net`, 13
  dígitos, ya con el `1`).
- **Grupo, mensaje propio** (`fromMe: true`): `key.participant` es el `@lid` propio y **no trae
  `participantAlt`**. El teléfono solo sale del `sender` del sobre.
- **DM**: `key.remoteJid` ya viene con el teléfono (`521…@s.whatsapp.net`) y `key.remoteJidAlt`
  repite el mismo valor. `key.participant` llega como cadena vacía.
- **DM propio** (`fromMe: true`): `remoteJid` es **el otro participante**.
- No aparecen `participantPn` ni `senderPn` (son nombres de Baileys 6.x).
- Cita: el texto va en `message.conversation`, y la cita en `data.contextInfo`
  (`stanzaId`, `participant` como `@lid` y `quotedMessage`), fuera de `message`.
- Foto: `message.imageMessage.caption`. Sticker: `stickerMessage`. Reacción:
  `message.reactionMessage {key, text, senderTimestampMs}`. Los primeros mensajes de un grupo
  traen también `senderKeyDistributionMessage` junto al texto.
- Los arreglos de bytes (`mediaKey`, `jpegThumbnail`, `messageSecret`…) llegan como objetos
  `{"0": n, "1": n, ...}`. En los fixtures se truncaron a 32 bytes.

### Lista definitiva de campos alternos

`LID_ALT_FIELDS = ["participantAlt", "remoteJidAlt"]` (en `sender.ts`). Se quitaron
`participantPn` y `senderPn`. Además, para mensajes `fromMe` el remitente se toma del `sender` del
sobre (ver abajo).

## Envío

| Destino de `POST /message/sendText/{i}` | HTTP | ¿Llegó a B? |
|---|---|---|
| `521XXXXXXXXXX` (con `1`) | 201 | sí |
| `52XXXXXXXXXX` (sin `1`) | 201 | sí |
| `<lid de B>@lid` | 201, `key.remoteJid` es `…@lid` | **sí**, en el mismo chat de A con B |

Las respuestas llegan con `status: "PENDING"`. La entrega se confirmó en el teléfono B.

**`sendText` a `@lid` funciona en v2.3.7.** Consecuencia para la **regla 15**: un remitente `@lid`
sin teléfono ya **no** pasa a NOTIFICAR por eso; se aparta enviando a `<lid>@lid`, que es lo que
ya hace `EvolutionAdapter.sendText` con `to.jid` `@lid`. La regla 15 queda solo como protección:
cuando el envío al `@lid` falla (error del proveedor) o cuando no hay ni teléfono ni LID. Sigue
siendo `remitente_sin_numero` con `pushName`. En la práctica, con esta versión casi todos los
remitentes de grupo traen `participantAlt`, así que el caso es raro.

Variante sin `1`: Evolution normaliza los dos formatos al mismo JID, así que el reintento sin `1`
de `sendText` nunca se dispara con números mexicanos válidos. Se deja porque no cuesta nada.

## Persistencia (T1.5)

`infra/scripts/verify-evolution-privacy.sh` después de unos 15 mensajes (grupo y DM, texto, cita,
foto, reacción, stickers) y de los envíos:

```
Message 0 · MessageUpdate 0 · Chat 0 · Contact 0 · Media 0 · IsOnWhatsapp 0 · Label 0
```

**Hallazgo**: la imagen copia su `.env.example` como `/evolution/.env` con casi todo en `true`, y
`dotenv` usa esos valores para cualquier variable que no definamos. En la primera pasada
`IsOnWhatsapp` tenía 1332 filas: los JIDs y números de **todos los contactos del teléfono**,
guardados al conectar (`DATABASE_SAVE_IS_ON_WHATSAPP=true` por defecto). Con el número del doctor,
eso habría sido su agenda completa. Cambios:

- `evolution.env.example` define `DATABASE_SAVE_IS_ON_WHATSAPP=false`, `TELEMETRY_ENABLED=false`
  y `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false`, y apaga de forma explícita las
  integraciones (websocket, rabbitmq, sqs, pusher, kafka, nats, s3, chatwoot, typebot, openai,
  dify, n8n, evoai).
- `IsOnWhatsapp` pasó a ser tabla obligatoria (0 filas) en el script.
- Se vació la tabla en el VPS (`TRUNCATE`) y se volvió a verificar con un envío y una consulta
  `whatsappNumbers`: queda en 0.

Riesgo residual (Redis, base 2): Evolution guarda la metadata de los grupos del teléfono
(`evolution:groups:<jid>`, incluye participantes, TTL de 7 días) y marcas de deduplicación de ids
de mensaje (10 bytes, TTL de unos 30 minutos, sin contenido). No hay contenido de mensajes en
Redis ni en Postgres.

## Diferencias con lo que asumía `packages/channels/src/evolution/`

1. `LID_ALT_FIELDS`: la lista real es `participantAlt` y `remoteJidAlt` (antes incluía
   `participantPn` y `senderPn`).
2. `parseEvolutionWebhook`: en mensajes `fromMe`, el remitente era incorrecto. En DM salía el
   otro participante y en grupo un `@lid` sin teléfono. Ahora se usa el `sender` del sobre (JID
   de la instancia). En grupo se conserva el `@lid` propio, así que quien llama puede guardar el
   par en `wa_lid_map`.
3. Rutas, cuerpos, `headers` del webhook, `restart` POST, 403 de instancia existente, forma de
   `connect`, `connectionState`, `connection.update`, `qrcode.updated` y `/group/participants`:
   **sin cambios**, coinciden con lo implementado en T1.3 y T1.4.

## Al actualizar Evolution (plan, 10.6)

Volver a revisar: `LID_ALT_FIELDS`, el `sender` del sobre, `/evolution/.env` de la imagen nueva
(defaults de `DATABASE_SAVE_*` y otros que no definimos) y el script de privacidad.
