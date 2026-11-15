/**
 * Checks the files with Polybar itself, in Docker: Polybar 3.7.1 (Ubuntu
 * 24.04) and 3.7.2 (Ubuntu 26.04), on i3 on Xvfb.
 *
 *   pnpm verify                  both releases
 *   pnpm verify -- 26.04         one Ubuntu release
 *
 * 1. themes/mistpine.ini defines every palette color as the spec has it, and
 *    Polybar's own names as mistpine's roles.
 * 2. Polybar loads examples/config.ini, unchanged, with no errors or
 *    warnings but the container's own (no wireless, no PulseAudio, one
 *    screen), and resolves the bar's colors through the references.
 * 3. The bar it draws has the example's colors on screen.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpec, ROOT } from "./lib/colors.ts";
import { image } from "./lib/docker.ts";
import { type Expect, expectPixels, load } from "./lib/pixels.ts";

const RELEASES = { "24.04": "3.7.1", "26.04": "3.7.2" } as const;
type Release = keyof typeof RELEASES;

const asked = process.argv.slice(2).filter((a) => a !== "--");
const releases = (asked.length ? asked : Object.keys(RELEASES)) as Release[];
for (const r of releases) if (!(r in RELEASES)) fail(`unknown release ${r}: use 24.04 or 26.04`);

function fail(message: string): never {
  console.error(`verify: ${message}`);
  process.exit(1);
}

const { spec } = await loadSpec();
const ui = (n: string) => (spec.ui[n]?.hex ?? fail(`the spec has no ui.${n}`)).toLowerCase();
const pal = (n: string) => (spec.palette[n] ?? fail(`the spec has no ${n}`)).toLowerCase();
const keyOf = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// ---------------------------------------------------------------- 1. the file

const STANDARD: Record<string, string> = {
  background: ui("statusBg"),
  "background-alt": ui("selection"),
  foreground: ui("statusFg"),
  primary: ui("warning"),
  secondary: ui("accent"),
  alert: ui("error"),
  disabled: pal("fg1"),
};

const values = new Map<string, string>();
let section = "";
for (const raw of readFileSync(join(ROOT, "themes", "mistpine.ini"), "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith(";")) continue;
  const head = line.match(/^\[(.+)\]$/);
  if (head) {
    section = head[1] as string;
    if (section !== "colors") fail(`mistpine.ini: unexpected section [${section}]`);
    continue;
  }
  const m = line.match(/^([a-z0-9-]+)\s*=\s*(\S+)$/);
  if (!m) fail(`mistpine.ini: unexpected line "${line}"`);
  values.set(m[1] as string, m[2] as string);
}
const resolved = (name: string): string | undefined => {
  const v = values.get(name);
  const ref = v?.match(/^\$\{colors\.([a-z0-9-]+)\}$/)?.[1];
  return ref ? resolved(ref) : v;
};
for (const [key, hex] of Object.entries(spec.palette)) {
  if (values.get(keyOf(key)) !== hex.toLowerCase()) {
    fail(`mistpine.ini: ${keyOf(key)} is ${values.get(keyOf(key))}, the spec says ${hex}`);
  }
}
for (const [name, want] of Object.entries(STANDARD)) {
  if (resolved(name) !== want) fail(`mistpine.ini: ${name} is ${resolved(name)}, want ${want}`);
}
if (values.size !== Object.keys(spec.palette).length + Object.keys(STANDARD).length) {
  fail("mistpine.ini has extra colors");
}
console.log(`mistpine.ini: ${values.size} colors match the spec`);

// ---------------------------------------------------------------- 2-3. Polybar

/** What Polybar resolves the example bar's colors to. */
const DUMP: Record<string, string> = {
  background: ui("statusBg"),
  foreground: ui("statusFg"),
  "separator-foreground": ui("border"),
};

/**
 * The bar at 1600 px wide, 96 dpi. Minimums are about half a good render. The
 * separator is a 1 px antialiased glyph here: the dump above checks its color.
 * Small text keeps few exact pixels at 96 dpi, so labels and values may be
 * slightly off; pnpm render checks them exactly, at 288 dpi.
 */
const EXPECT: Expect[] = [
  { label: "bar background (statusBg)", hex: ui("statusBg"), min: 15_000 },
  { label: "focused workspace (selection)", hex: ui("selection"), min: 300 },
  { label: "focused underline (accent)", hex: ui("accent"), min: 40 },
  { label: "labels (yellow)", hex: pal("yellow"), min: 10, tolerance: 12 },
  { label: "values (bright purple)", hex: pal("brightPurple"), min: 10, tolerance: 12 },
];

/** The container's own: no wireless, no PulseAudio, one screen, and 3.7.1's tray. */
const NOISE = [
  /Disabling module "network" \(reason: No interface found/,
  /Disabling module "pulseaudio" \(reason: Could not connect pulseaudio context/,
  /No monitor specified, using "screen"/,
  /Systray selection already managed/,
];

for (const release of releases) {
  const tag = image(release);
  const out = mkdtempSync(join(tmpdir(), "mistpine-polybar-verify-"));
  try {
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--init",
        "-v",
        `${join(ROOT, "themes")}:/themes:ro`,
        "-v",
        `${join(ROOT, "examples")}:/examples:ro`,
        "-v",
        `${join(ROOT, "scripts", "verify", "run.sh")}:/run.sh:ro`,
        "-v",
        `${out}:/out`,
        "--user",
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        "-e",
        "HOME=/tmp/home",
        tag,
        "sh",
        "/run.sh",
      ],
      { stdio: ["ignore", "inherit", "inherit"], timeout: 120_000 },
    );
    const version = readFileSync(join(out, "version"), "utf8").match(/polybar (\S+)/)?.[1];
    if (version !== RELEASES[release]) fail(`ubuntu:${release} has Polybar ${version}`);
    const label = `Polybar ${version} (ubuntu:${release})`;

    const problems = readFileSync(join(out, "polybar.log"), "utf8")
      .split("\n")
      .filter((l) => /\|(warn|error):/.test(l))
      .filter((l) => !NOISE.some((n) => n.test(l)));
    if (problems.length) fail(`${label} reported:\n  ${problems.join("\n  ")}`);

    for (const line of readFileSync(join(out, "dump"), "utf8").trim().split("\n")) {
      const [key, value] = line.split(" ") as [string, string];
      if (value?.toLowerCase() !== DUMP[key])
        fail(`${label}: bar ${key} is ${value}, want ${DUMP[key]}`);
    }

    const missing = expectPixels(load(join(out, "bar")), EXPECT);
    if (missing.length) fail(`${label}: the bar is missing colors:\n  ${missing.join("\n  ")}`);
    console.log(`${label}: no errors, colors resolve to the spec, and the bar shows them`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
