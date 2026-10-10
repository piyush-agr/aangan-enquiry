import { config } from "@/lib/config/env";
import { MockVoiceAdapter } from "./mock";
import type { VoiceProviderAdapter } from "./types";
import { VaaniYantraAdapter } from "./vaaniyantra";

/** The adapter for real webhooks. In mock mode no public webhook is accepted. */
export function webhookAdapter(): VoiceProviderAdapter {
  const cfg = config();
  return cfg.VOICE_PROVIDER === "vaaniyantra" ? new VaaniYantraAdapter(cfg) : new MockVoiceAdapter();
}

export function adapterFor(provider: string): VoiceProviderAdapter | undefined {
  if (provider === "vaaniyantra") return new VaaniYantraAdapter(config());
  if (provider === "mock") return new MockVoiceAdapter();
  return undefined;
}

export * from "./types";
