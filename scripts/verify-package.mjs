import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
assert.deepEqual(Object.keys(packageJson.dependencies), ["yaml"]);

const esm = await import(new URL("dist/index.js", root));
const cjs = createRequire(import.meta.url)(
  fileURLToPath(new URL("dist/index.cjs", root)),
);
const coreEsm = await import(new URL("dist/core.js", root));
const coreCjs = createRequire(import.meta.url)(
  fileURLToPath(new URL("dist/core.cjs", root)),
);
const profilesEsm = await import(new URL("dist/profiles.js", root));
const profilesCjs = createRequire(import.meta.url)(
  fileURLToPath(new URL("dist/profiles.cjs", root)),
);

const directory = mkdtempSync(join(tmpdir(), "skill-resolver-package-"));
try {
  mkdirSync(join(directory, ".git"));
  mkdirSync(join(directory, "skills", "demo"), { recursive: true });
  writeFileSync(
    join(directory, "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Packed API smoke test\n---\n# Demo\n",
  );
  writeFileSync(join(directory, "skills", "demo", "guide.txt"), "guide");

  for (const api of [esm, cjs]) {
    const result = await api.resolveSkills({ root: directory });
    assert.equal(result.skills[0].metadata.name, "demo");
    assert.equal(
      (await api.readSkillResource(result.skills[0], "guide.txt")).text,
      "guide",
    );
  }
  assert.equal(
    coreEsm.parseSkillContent("---\nname: x\ndescription: x\n---\n").ok,
    true,
  );
  assert.equal(
    coreCjs.parseSkillContent("---\nname: x\ndescription: x\n---\n").ok,
    true,
  );
  assert.equal(profilesEsm.skillProfiles.universal.name, "universal");
  assert.equal(profilesCjs.skillProfiles.claude.name, "claude");

  const cli = fileURLToPath(new URL("dist/cli.js", root));
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /^skill-resolver/u,
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
    }).trim(),
    packageJson.version,
  );
  assert.match(
    execFileSync(process.execPath, [cli, "show", "demo"], {
      cwd: directory,
      encoding: "utf8",
    }),
    /# Demo/u,
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "read", "demo", "guide.txt"], {
      cwd: directory,
      encoding: "utf8",
    }),
    "guide",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write(
  "Packed ESM, CommonJS, subpath exports, resources, CLI, and metadata verification passed.\n",
);
