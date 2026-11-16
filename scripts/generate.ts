/**
 * Writes the Polybar files from the mistpine spec:
 *
 * - themes/mistpine.ini: a [colors] section with the palette, plus the
 *   names Polybar's own default config reads (background, foreground,
 *   primary, alert, disabled…), for `include-file`.
 * - examples/config.ini: the bar in the screenshots (src/config.ini),
 *   including mistpine.ini from next to it.
 *
 *   pnpm generate          write the files
 *   pnpm generate --check  fail if any file is out of date
 *
 * Every color comes from palette/mistpine.json in the reference repository
 * (read by @mistpine/port-kit). Before anything is written, the example may use
 * colors only as ${colors.*} references that mistpine.ini defines, and
 * every text color must clear 4.5:1 on the background it sits on.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contrast, loadSpec, mix } from "@mistpine/port-kit";

const ROOT = join(import.meta.dirname, "..");

const check = process.argv.includes("--check");
const { spec, source } = await loadSpec(ROOT);

/** The key for a palette color: `brightRed` → `bright-red`. */
const keyOf = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const palette = new Map(
  Object.entries(spec.palette).map(([k, hex]) => [keyOf(k), hex.toLowerCase()]),
);

/** Polybar's own names (its default config) → spec tokens. */
const STANDARD: [string, string, string][] = [
  ["background", "ui.statusBg", "the bar, a status line"],
  ["background-alt", "ui.selection", "raised: the focused workspace"],
  ["foreground", "ui.statusFg", "text on the bar"],
  ["primary", "ui.warning", "labels and highlights"],
  ["secondary", "ui.accent", "the accent"],
  ["alert", "ui.error", "urgent and failing"],
  ["disabled", "fg1", "idle, empty, offline"],
];

/** A palette key, a standard name or a spec token, as #rrggbb, and its palette key. */
function resolve(key: string): { hex: string; palette: string } {
  if (key.startsWith("ui.")) {
    const t = spec.ui[key.slice(3)];
    if (!t?.ref) throw new Error(`the spec's ${key} is not a palette color`);
    return { hex: t.hex.toLowerCase(), palette: keyOf(t.ref) };
  }
  const std = STANDARD.find(([name]) => name === key);
  if (std) return resolve(std[1]);
  const hex = palette.get(key);
  if (!hex) throw new Error(`no color ${key}`);
  return { hex, palette: key };
}
const hexOf = (key: string) => resolve(key).hex;

/** Recomputes the spec's blends, so the port provably uses the spec's math. */
function verifyBlends(): void {
  const names: Record<string, string> = {
    "@terminal.background": spec.terminal.background?.hex ?? "",
  };
  let checked = 0;
  for (const [name, t] of Object.entries(spec.ui)) {
    if (!t.derived) continue;
    const m = t.derived.match(/^mix\((\S+), \$(\w+), (\d+)%\)$/);
    if (!m) throw new Error(`ui.${name}: unknown blend ${t.derived}`);
    const [, base, key, pct] = m as unknown as [string, string, string, string];
    const from = names[base] ?? hexOf(keyOf(base.replace(/^\$/, "")));
    const got = mix(from, hexOf(keyOf(key)), Number(pct) / 100);
    if (got !== t.hex) throw new Error(`ui.${name}: ${t.derived} gives ${got}, spec says ${t.hex}`);
    checked++;
  }
  if (checked === 0) throw new Error("the spec has no blends: did its format change?");
}

/** Text on background, as src/config.ini pairs them (and the default config's labels). */
const PAIRS: [string, string, string][] = [
  ["bar text", "foreground", "background"],
  ["labels", "yellow", "background"],
  ["values", "bright-purple", "background"],
  ["disabled modules", "disabled", "background"],
  ["focused workspace", "fg3", "bg3"],
  ["visible workspace", "fg2", "background"],
  ["unfocused workspaces", "fg1", "background"],
  ["urgent workspace", "bg0", "red"],
  ["binding mode", "bg0", "yellow"],
  ["default config: primary on background", "primary", "background"],
  ["default config: text on background-alt", "foreground", "background-alt"],
];

// ---------------------------------------------------------------- lint

const failures: string[] = [];
for (const [what, fg, bg] of PAIRS) {
  const r = contrast(hexOf(fg), hexOf(bg));
  if (r < 4.5) {
    failures.push(
      `${what}: ${fg} on ${bg} is ${(Math.floor(r * 100) / 100).toFixed(2)}:1, want 4.5:1`,
    );
  }
}

const src = readFileSync(join(ROOT, "src", "config.ini"), "utf8");
const defined = new Set([...palette.keys(), ...STANDARD.map(([n]) => n)]);
for (const m of src.matchAll(/\$\{colors\.([a-z0-9-]+)\}/g)) {
  if (!defined.has(m[1] as string)) failures.push(`src/config.ini: colors.${m[1]} is not defined`);
}
for (const line of src.split("\n")) {
  if (/^\s*;/.test(line)) continue;
  if (/#[0-9a-f]{3,8}\b|%\{[FBUo]#/i.test(line)) {
    failures.push(`src/config.ini: a literal color in "${line.trim()}": use \${colors.*}`);
  }
}
// The README lists the palette: every color must be there, as the spec has it.
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
for (const [name, hex] of palette) {
  if (!readme.includes(`\`${hex}\``)) failures.push(`README.md: no \`${hex}\` for ${name}`);
}
verifyBlends();

if (failures.length) {
  console.error(`generate: ${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------- write

const GENERATED = [
  "; Generated by scripts/generate.ts from the mistpine spec",
  "; (https://github.com/mistpine/mistpine/blob/main/palette/mistpine.json).",
  "; Do not edit by hand.",
];
const width = Math.max(...[...defined].map((n) => n.length));
const row = (name: string, value: string) => `${name.padEnd(width)} = ${value}`;

const colors = [
  "; mistpine for Polybar: https://github.com/mistpine/mistpine.polybar",
  "; MIT License",
  ";",
  "; Include it from your config and use the names as ${colors.bg2}:",
  ";   include-file = ~/.config/polybar/mistpine.ini",
  ";",
  ...GENERATED,
  "",
  "[colors]",
  "; The palette.",
  ...[...palette].map(([name, hex]) => row(name, hex)),
  "",
  "; The names Polybar's default config reads, as mistpine's roles.",
  ...STANDARD.flatMap(([name, token, why]) => [
    `; ${why}`,
    row(name, `\${colors.${resolve(token).palette}}`),
  ]),
  "",
].join("\n");

const example = [
  "; mistpine for Polybar: the bar in the screenshots.",
  "; https://github.com/mistpine/mistpine.polybar · MIT License",
  "; Generated by scripts/generate.ts from src/config.ini. Do not edit by hand.",
  ";",
  "; Save as ~/.config/polybar/config.ini with mistpine.ini next to it, and",
  "; start it with: polybar mistpine",
  "",
  "include-file = mistpine.ini",
  "",
  src.replace(/^(;.*\n)+\n/, ""),
].join("\n");

const outputs: [string, string][] = [
  ["themes/mistpine.ini", colors],
  ["examples/config.ini", example],
];
let stale = 0;
for (const [rel, text] of outputs) {
  const file = join(ROOT, rel);
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {}
  if (current === text) continue;
  if (check) {
    console.error(`${rel} is out of date: run pnpm generate`);
    stale++;
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${rel}`);
}
if (stale) process.exit(1);
console.log(`${check ? "up to date" : "done"} (spec: ${source})`);
