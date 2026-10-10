import { expect, test, type Page } from "@playwright/test";

const APPROVED = "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

async function login(page: Page, email = "admin@e2e.test", password = "e2e-admin-password") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

async function playScenario(page: Page, id: string) {
  await page.goto("/simulator");
  await page.locator("select").first().selectOption(id);
  await page.getByRole("button", { name: "Play scenario" }).click();
  await expect(page.getByText("Saved as a demo enquiry")).toBeVisible({ timeout: 20_000 });
}

test("health is public and minimal; pages and APIs require a session", async ({ page, request }) => {
  const h = await request.get("/api/health");
  expect(h.status()).toBe(200);
  const body = await h.json();
  expect(body).toMatchObject({ database: "ok", voice: { mode: "MOCK" } });
  expect(JSON.stringify(body)).not.toMatch(/secret|postgres:/i);
  expect((await request.get("/api/enquiries")).status()).toBe(401);
  expect((await request.get("/api/metrics")).status()).toBe(401);
  expect((await request.post("/api/simulator/turn", { data: {} })).status()).toBe(401);
  await page.goto("/enquiries");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password is refused with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@e2e.test");
  await page.getByLabel("Password").fill("nope-nope-nope");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".alert.err")).toHaveText("Email or password is incorrect.");
});

test("mock mode is obvious and an empty dashboard says what to do", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Mock mode: no real calls are being received")).toBeVisible();
  await expect(page.getByText("No calls in this period yet")).toBeVisible();
});

test("qualified simulated call → enquiry, qualification, simulated Telegram preview", async ({ page }) => {
  await login(page);
  await playScenario(page, "qualified-kothrud");
  await page.goto((await page.getByRole("link", { name: /Open the enquiry/ }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: "Priya" })).toBeVisible();
  await expect(page.locator(".tag.t-QUALIFIED").first()).toBeVisible();
  await expect(page.getByText("Demo: this message was previewed, not sent.")).toBeVisible();
  await expect(page.getByLabel("Message preview")).toContainText("AANGAN STUDIO — NEW QUALIFIED ENQUIRY");
  await expect(page.getByLabel("Message preview")).toContainText("NOT yet booked");
  await expect(page.getByText("Requested (not booked)")).toBeVisible();
});

test("pricing: every price question gets the approved response and no figure appears", async ({ page }) => {
  await login(page);
  await playScenario(page, "pricing-wakad");
  const agent = page.locator(".bubble.AGENT");
  const texts = await agent.allInnerTexts();
  expect(texts.filter((t) => t.includes(APPROVED)).length).toBeGreaterThanOrEqual(3);
  for (const t of texts) expect(t).not.toMatch(/₹|\blakh\b|per sq|\d{3,}/i);
});

test("declined, complaint and missed calls route correctly; overview counts match", async ({ page }) => {
  await login(page);
  await playScenario(page, "nashik");
  await playScenario(page, "complaint");
  await playScenario(page, "missed");
  await page.goto("/attention?demo=1");
  await expect(page.getByRole("heading", { name: "Urgent: existing clients (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Missed calls (1)" })).toBeVisible();
  await page.goto("/enquiries?demo=1&disposition=NOT_QUALIFIED");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Not needed");
  // 5 demo calls so far (2 earlier tests + 3 here). Without demo they are excluded.
  await page.goto("/?demo=1");
  await expect(page.locator(".fig", { hasText: "Incoming calls" }).locator("dd")).toHaveText("5");
  await page.goto("/");
  await expect(page.getByText("No calls in this period yet")).toBeVisible();
});

test("Telegram failure keeps the enquiry and offers a resend", async ({ page }) => {
  await login(page);
  await playScenario(page, "telegram-failure");
  await page.goto((await page.getByRole("link", { name: /Open the enquiry/ }).getAttribute("href"))!);
  await expect(page.locator(".tag.t-FAILED").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend to Telegram" })).toBeVisible();
});

test("staff cannot change cost rates; admin can, and unknown costs say so", async ({ page, browser }) => {
  await login(page);
  await page.goto("/costs?demo=1");
  await expect(page.getByText(/call costs show as/)).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Rate (₹)").fill("5");
  await page.getByLabel("Where this rate comes from").fill("E2E test rate, not a real price");
  await page.getByRole("button", { name: "Save rate" }).click();
  await expect(page.getByText("Rate saved.")).toBeVisible();

  const staff = await browser.newPage();
  await login(staff, "staff@e2e.test", "e2e-staff-password");
  const r = await staff.request.post("/api/settings/rates", { data: { provider: "vaaniyantra", category: "voice_minute", unit: "minute", rate: 1, source: "should be refused" } });
  expect(r.status()).toBe(403);
  await staff.close();
});

test("operator changes are audited", async ({ page }) => {
  await login(page);
  await page.goto("/enquiries?demo=1&q=Priya");
  const href = await page.locator("tbody tr a").first().getAttribute("href");
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: "Priya" })).toBeVisible();
  await page.getByLabel("Consultation").selectOption("BOOKED_CONFIRMED");
  await page.getByRole("button", { name: "Save consultation" }).click();
  await expect(page.getByText("Consultation saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("consultation.changed")).toBeVisible();
});
