import fs from "node:fs";
import path from "node:path";

/**
 * Fails if anything from the internal pricing guide, the budget-floor constants, or a secret-looking
 * value reached the browser bundle (.next/static). Run after `next build`.
 */
const ROOT = path.resolve(".next/static");
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "pricing tier names", re: /Premium specification|Luxury specification|Standard specification|Mid-range office|Basic fitout/i },
  { label: "per-sq-ft figures", re: /₹\s?1,?800|₹\s?2,?400|₹\s?3,?500|₹\s?1,?200|₹\s?2,?800|₹\s?4,?000/ },
  { label: "budget floor constants", re: /singleRoomAllInMin|residentialPerSqFtMin|commercialPerSqFtMin|CLEARLY_BELOW_FRACTION/ },
  { label: "internal pricing guide text", re: /Internal Pricing Guide|Indicative range/ },
  { label: "secret-like values", re: /ck_live_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}|\d{6,}:[A-Za-z0-9_-]{30,}/ },
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

if (!fs.existsSync(ROOT)) {
  console.error("✖ .next/static not found — run `npm run build` first");
  process.exit(1);
}
const files = walk(ROOT).filter((f) => /\.(js|css|html|json|txt|map)$/.test(f));
let failures = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const { label, re } of FORBIDDEN) {
    if (re.test(text)) {
      failures++;
      console.error(`✖ ${label} found in ${path.relative(process.cwd(), f)}`);
    }
  }
}
if (failures) process.exit(1);
console.log(`✔ scanned ${files.length} client bundle files — no internal pricing data or secrets`);
