/**
 * Renders the README image from Polybar itself and checks its pixels:
 * assets/preview.png, the example bar with a focused, an idle and an urgent
 * i3 workspace and the resize mode.
 *
 * It runs in Docker (scripts/render/Dockerfile, scene.sh): Polybar on i3 on
 * Xvfb at 288 dpi, so the strip stays readable when GitHub shrinks it.
 * scripts/render/render.ini inherits the example's bar and gives the
 * network, volume and date modules fixed values. The README image comes
 * from Ubuntu 26.04 (Polybar 3.7.2); 24.04 (3.7.1) renders it too, for the
 * pixel checks.
 *
 *   pnpm render
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSpec } from "@mistpine/port-kit";
import { image } from "@mistpine/port-kit/docker";
import { type Expect, expectPixels, hexAt, type Image, load } from "@mistpine/port-kit/pixels";

const ROOT = join(import.meta.dirname, "..");

const WORK = join(ROOT, ".render");
const ASSETS = join(ROOT, "assets");
const { spec } = await loadSpec(ROOT);
const ui = (name: string) => (spec.ui[name]?.hex ?? "").toLowerCase();
const pal = (name: string) => (spec.palette[name] ?? "").toLowerCase();
const CANVAS = ui("editorBg");

function rowIsCanvas(img: Image, y: number): boolean {
  for (let x = 0; x < img.width; x++) if (hexAt(img, y * img.width + x) !== CANVAS) return false;
  return true;
}

/** Minimums are about half of what a good render has. */
const EXPECT: Expect[] = [
  { label: "bar background (statusBg)", hex: ui("statusBg"), min: 80_000 },
  { label: "focused workspace (selection)", hex: ui("selection"), min: 3_000 },
  { label: "focused underline (accent)", hex: ui("accent"), min: 300 },
  { label: "separators (border)", hex: ui("border"), min: 100 },
  { label: "urgent workspace (error)", hex: ui("error"), min: 3_000 },
  { label: "resize mode (warning)", hex: ui("warning"), min: 5_000 },
  { label: "focused workspace text", hex: pal("fg3"), min: 30 },
  { label: "idle workspace text", hex: pal("fg1"), min: 30 },
  { label: "values (bright purple)", hex: pal("brightPurple"), min: 300 },
];
/** The container has one screen and no monitor name to give. */
const NOISE = /No monitor specified, using "screen"/;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });
const uid = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
const failures: string[] = [];

for (const release of ["26.04", "24.04"]) {
  const tag = image({
    name: "mistpine-polybar",
    release,
    context: join(ROOT, "scripts", "render"),
  });
  const out = join(WORK, release);
  mkdirSync(out, { recursive: true });
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
      `${join(ROOT, "scripts", "render")}:/scene:ro`,
      "-v",
      `${out}:/out`,
      "--user",
      uid,
      "-e",
      "HOME=/tmp/home",
      tag,
      "sh",
      "/scene/scene.sh",
    ],
    { stdio: ["ignore", "ignore", "inherit"], timeout: 120_000 },
  );
  const label = `bar (ubuntu:${release})`;
  const said = readFileSync(join(out, "polybar.log"), "utf8")
    .split("\n")
    .filter((l) => /\|(warn|error):/.test(l) && !NOISE.test(l));
  const img = load(join(out, "bar"));
  const fails = [...said, ...expectPixels(img, EXPECT)];
  if (fails.length) {
    failures.push(`${label}:\n  ${fails.join("\n  ")}`);
    console.log(`✗ ${label}`);
    continue;
  }
  console.log(`✓ ${label}`);
  if (release !== "26.04") continue;
  // The bar alone: the rows down to the first one that is all canvas.
  let height = 0;
  while (height < img.height && !rowIsCanvas(img, height)) height++;
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${out}:/out`,
      "-v",
      `${ASSETS}:/assets`,
      "--user",
      uid,
      tag,
      "convert",
      "/out/bar.png",
      "-crop",
      `${img.width}x${height}+0+0`,
      "+repage",
      "-strip",
      "/assets/preview.png",
    ],
    { stdio: "inherit" },
  );
}

if (failures.length) {
  console.error(`render: checks failed\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("wrote assets/preview.png");
