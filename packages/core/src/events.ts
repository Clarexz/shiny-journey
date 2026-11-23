/**
 * Canal de Redis pub/sub que avisa al worker que cambió la configuración de un agente o de un
 * canal (plan, 4.3 y 6.1). El worker recarga su tabla de ruteo sin reiniciar.
 */
export const CONFIG_CHANGED_CHANNEL = "config:changed";

/** Cuerpo del mensaje (JSON). Solo ids: nunca configuración ni datos personales. */
export interface ConfigChangedMessage {
  agentConfigId?: string;
  channelId?: string;
}
