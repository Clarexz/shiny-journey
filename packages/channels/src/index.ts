export * from "./types";
export * from "./phone";
export { validateSendInput } from "./send";
export {
  ChannelRegistry,
  assertCapabilities,
  missingCapabilities,
  resolveChannelRow,
  type AdapterDecorator,
  type AdapterFactory,
  type ResolvedChannel,
} from "./registry";
export {
  FAKE_SIGNATURE_HEADER,
  FakeAdapter,
  FakeOutbox,
  signFakeWebhook,
  type FakeAdapterOptions,
  type FakeSentMessage,
  type FakeWebhookEvent,
  type FakeWebhookPayload,
} from "./fake/adapter";
export { dryRunDecorator, isDryRunAdapter, withDryRun } from "./dry-run";
export { createChannelRegistry, type CreateChannelRegistryOptions } from "./create-registry";
export {
  EVOLUTION_CAPABILITIES,
  EVOLUTION_INSTANCE_SETTINGS,
  EVOLUTION_WEBHOOK_EVENTS,
  EvolutionAdapter,
  WEBHOOK_TOKEN_HEADER,
  type EvolutionAdapterOptions,
} from "./evolution/adapter";
export {
  DEFAULT_EVOLUTION_TIMEOUT_MS,
  EvolutionClient,
  type EvolutionClientOptions,
  type EvolutionRequest,
} from "./evolution/client";
export {
  extractContent,
  mapConnectionState,
  normalizeEventName,
  parseEvolutionWebhook,
  parseTimestamp,
  type EvolutionParseContext,
} from "./evolution/parse";
export {
  LID_ALT_FIELDS,
  resolveSender,
  type LidLookup,
  type ResolvedSender,
  type SenderSource,
} from "./evolution/sender";
