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
