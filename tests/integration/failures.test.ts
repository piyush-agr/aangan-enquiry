import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/vaaniyantra/route";
import { closeDb } from "@/lib/db/client";
import { healthReport } from "@/lib/health";
import { computeSignature } from "@/lib/voice-provider/vaaniyantra";
import { setEnv, setupDb } from "./helpers";

const SECRET = "whsec_test_secret";
const signed = (obj: unknown) => {
  const body = JSON.stringify(obj);
  return new Request("http://localhost/api/webhooks/vaaniyantra", { method: "POST", body, headers: { "x-vaaniyantra-signature": computeSignature(body, SECRET) } });
};
const good = { event: "call.completed", timestamp: new Date().toISOString(), data: { id: "c-db-loss", direction: "INBOUND", status: "COMPLETED", durationSec: 30 } };

beforeAll(async () => {
  await setupDb();
  setEnv({ VOICE_PROVIDER: "vaaniyantra", VAANIYANTRA_WEBHOOK_SECRET: SECRET });
});
afterAll(async () => {
  setEnv({ VOICE_PROVIDER: "mock", DATABASE_URL: "postgres://aangan:aangan_dev@localhost:5432/aangan_test" });
  await closeDb();
});

describe("failure injection", () => {
  it("rejects invalid provider-generated structured data (nested objects in collectedData)", async () => {
    const res = await POST(signed({ ...good, data: { ...good.data, collectedData: { name: { first: "x" } } } }));
    expect(res.status).toBe(400);
  });

  it("database loss: health reports error without leaking the URL, webhook answers 503 for redelivery", async () => {
    await closeDb();
    setEnv({ DATABASE_URL: "postgres://aangan:wrongpass@localhost:1/aangan_test" });
    const h = await healthReport();
    expect(h.status).toBe("error");
    expect(JSON.stringify(h)).not.toMatch(/wrongpass/);
    const res = await POST(signed(good));
    expect(res.status).toBe(503);
    await closeDb();
  });
});
