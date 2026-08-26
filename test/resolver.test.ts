import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverSkills,
  explainSkills,
  findSkillRoot,
  getResolvedSkill,
  lintSkills,
  resolveSkills,
} from "../src/resolver.js";
import { getSkillProfile } from "../src/profiles.js";
import { fixture, skill, write } from "./helpers.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function root(): Promise<string> {
  const value = await fixture();
  roots.push(value);
  return value;
}

describe("profiles and roots", () => {
  it("finds a git root from directories, files, and nonexistent file targets", async () => {
    const project = await root();
    await write(join(project, "src", "index.ts"), "");
    expect(await findSkillRoot(join(project, "src"))).toBe(project);
    expect(await findSkillRoot(join(project, "src", "index.ts"))).toBe(project);
    expect(await findSkillRoot(join(project, "src", "future.ts"))).toBe(
      project,
    );
  });

  it("rejects invalid predefined and custom profiles", () => {
    expect(() => getSkillProfile("wat" as "codex")).toThrow("Unknown");
    expect(() => getSkillProfile({ name: "", projectLocations: [] })).toThrow(
      TypeError,
    );
    expect(() =>
      getSkillProfile({ name: "x", projectLocations: ["\0"] }),
    ).toThrow(TypeError);
  });
});

describe("resolution", () => {
  it("discovers universal paths and respects depth", async () => {
    const project = await root();
    await write(join(project, "skills", "alpha", "SKILL.md"), skill("alpha"));
    await write(
      join(project, ".claude", "skills", "nested", "beta", "SKILL.md"),
      skill("beta"),
    );
    expect(
      (await discoverSkills({ root: project })).map((entry) => entry.directory),
    ).toHaveLength(2);
    expect(await discoverSkills({ root: project, maxDepth: 0 })).toHaveLength(
      0,
    );
  });

  it("applies global then project then custom precedence", async () => {
    const project = await root();
    const global = join(project, "global");
    const custom = join(project, "custom");
    await write(join(global, "same", "SKILL.md"), skill("same", "global"));
    await write(
      join(project, "skills", "same", "SKILL.md"),
      skill("same", "project"),
    );
    await write(join(custom, "same", "SKILL.md"), skill("same", "custom"));
    const result = await resolveSkills({
      root: project,
      includeGlobal: true,
      globalLocations: [global],
      locations: [custom],
    });
    expect(result.skills[0]?.metadata.description).toBe("custom");
    expect(
      result.omitted.filter((entry) => entry.reason === "shadowed"),
    ).toHaveLength(2);
    expect(
      result.issues.some((entry) => entry.code === "duplicate-skill"),
    ).toBe(true);
  });

  it("omits invalid and oversized skills and reports lint modes", async () => {
    const project = await root();
    await write(join(project, "skills", "bad", "SKILL.md"), "not yaml");
    await write(
      join(project, "skills", "huge", "SKILL.md"),
      skill("huge", "x".repeat(100)),
    );
    const result = await resolveSkills({ root: project, maxSkillBytes: 80 });
    expect(result.skills).toHaveLength(0);
    expect(result.omitted).toHaveLength(2);
    expect((await lintSkills({ root: project })).ok).toBe(false);
    await write(
      join(project, "skills", "bad", "SKILL.md"),
      skill("bad") + "\nextra: ignored",
    );
    expect((await lintSkills({ root: project, strict: true })).ok).toBe(true);
  });

  it("gets and explains resolved skills", async () => {
    const project = await root();
    await write(
      join(project, ".github", "skills", "demo", "SKILL.md"),
      skill("demo"),
    );
    const result = await resolveSkills({ root: project });
    expect(getResolvedSkill(result, "demo")?.metadata.name).toBe("demo");
    expect(getResolvedSkill(result, "missing")).toBeUndefined();
    expect(explainSkills(result)).toContain("Resolved: 1 skill(s)");
  });

  it("blocks links by default, follows safe links, and rejects escapes", async () => {
    const project = await root();
    await write(
      join(project, "skills", ".store", "safe", "SKILL.md"),
      skill("safe"),
    );
    await mkdir(join(project, "skills"), { recursive: true });
    await symlink(
      join(project, "skills", ".store", "safe"),
      join(project, "skills", "safe"),
    );
    const blocked = await resolveSkills({ root: project });
    expect(
      blocked.issues.some((issue) => issue.code === "symlink-blocked"),
    ).toBe(true);
    expect(
      (await resolveSkills({ root: project, followSymlinks: true })).skills,
    ).toHaveLength(1);
    const outside = await root();
    await write(join(outside, "escape", "SKILL.md"), skill("escape"));
    await symlink(join(outside, "escape"), join(project, "skills", "escape"));
    expect(
      (
        await resolveSkills({ root: project, followSymlinks: true })
      ).issues.some((issue) => issue.code === "outside-root"),
    ).toBe(true);
  });

  it("applies the same boundary rules to SKILL.md file links", async () => {
    const project = await root();
    await write(join(project, "skills", "source.md"), skill("filelink"));
    await mkdir(join(project, "skills", "filelink"), { recursive: true });
    await symlink(
      join(project, "skills", "source.md"),
      join(project, "skills", "filelink", "SKILL.md"),
    );
    expect(
      (await resolveSkills({ root: project })).issues.some(
        (issue) => issue.code === "symlink-blocked",
      ),
    ).toBe(true);
    expect(
      (await resolveSkills({ root: project, followSymlinks: true })).skills[0]
        ?.metadata.name,
    ).toBe("filelink");

    const outside = await root();
    await write(join(outside, "outside.md"), skill("escape-file"));
    await mkdir(join(project, "skills", "escape-file"), { recursive: true });
    await symlink(
      join(outside, "outside.md"),
      join(project, "skills", "escape-file", "SKILL.md"),
    );
    expect(
      (
        await resolveSkills({ root: project, followSymlinks: true })
      ).issues.some((issue) => issue.code === "outside-root"),
    ).toBe(true);
  });

  it("validates runtime numeric and policy options", async () => {
    const project = await root();
    await expect(
      resolveSkills({ root: project, maxDepth: -1 }),
    ).rejects.toThrow(TypeError);
    await expect(
      resolveSkills({ root: project, maxSkillBytes: 0 }),
    ).rejects.toThrow(TypeError);
    await expect(
      resolveSkills({ root: project, unknownFields: "wat" as "warn" }),
    ).rejects.toThrow(TypeError);
  });
});
