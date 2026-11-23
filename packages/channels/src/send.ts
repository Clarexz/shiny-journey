import { ChannelError, type Provider, type SendTextInput } from "./types";

/** Validación común de `sendText`, compartida por todos los adaptadores. */
export function validateSendInput(input: SendTextInput, provider: Provider): void {
  const fail = (message: string) => {
    throw new ChannelError("invalid_input", `sendText: ${message}`, { provider, retryable: false });
  };
  if (!input.to.jid && !input.to.phone) fail("falta el destino (jid o phone)");
  if (input.to.jid && input.to.phone) fail("indica jid o phone, no ambos");
  if (input.text.trim() === "") fail("texto vacío");
  if (input.idempotencyKey.trim() === "") fail("falta idempotencyKey");
  if (input.typingMs !== undefined && (!Number.isFinite(input.typingMs) || input.typingMs < 0)) {
    fail("typingMs inválido");
  }
}
