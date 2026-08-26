import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

const api = await import("../dist/index.js");
const directory = mkdtempSync(join(tmpdir(), "skill-resolver-stress-"));
try {
  mkdirSync(join(directory, ".git"));
  const skills = join(directory, "skills");
  for (let index = 0; index < 1_000; index += 1) {
    const name = `skill-${String(index).padStart(4, "0")}`;
    const path = join(skills, name);
    mkdirSync(join(path, "references"), { recursive: true });
    writeFileSync(
      join(path, "SKILL.md"),
      `---\nname: ${name}\ndescription: Stress fixture ${index}\n---\n# ${name}\n`,
    );
    if (index < 200)
      writeFileSync(join(path, "references", "guide.md"), `Guide ${index}`);
  }

  const started = performance.now();
  const result = await api.resolveSkills({ root: directory });
  const elapsed = performance.now() - started;
  assert.equal(result.skills.length, 1_000);
  assert.equal(
    result.issues.filter((issue) => issue.severity === "error").length,
    0,
  );
  assert.ok(
    elapsed < 10_000,
    `stress resolution took ${elapsed.toFixed(0)} ms`,
  );
  const resources = await api.listSkillResources(result.skills[0]);
  assert.equal(resources.length, 1);
  process.stdout.write(
    `Resolved 1,000 skills in ${elapsed.toFixed(0)} ms and verified bounded resources.\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
