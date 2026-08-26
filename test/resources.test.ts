import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  listSkillResources,
  readSkillResource,
  SkillResourceError,
} from "../src/resources.js";
import { resolveSkills } from "../src/resolver.js";
import type { ResolvedSkill } from "../src/types.js";
import { fixture, skill, write } from "./helpers.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

async function setup(): Promise<{ root: string; resolved: ResolvedSkill }> {
  const root = await fixture();
  roots.push(root);
  await write(join(root, "skills", "demo", "SKILL.md"), skill("demo"));
  const result = await resolveSkills({ root });
  const resolved = result.skills[0];
  if (resolved === undefined) throw new Error("Fixture skill did not resolve");
  return { root, resolved };
}

describe("skill resources", () => {
  it("reads text and binary resources with media metadata", async () => {
    const { resolved } = await setup();
    await write(join(resolved.directory, "references", "guide.md"), "hello");
    await write(
      join(resolved.directory, "assets", "pixel.png"),
      new Uint8Array([1, 2, 3]),
    );
    expect(
      await readSkillResource(resolved, "references/guide.md"),
    ).toMatchObject({ text: "hello", mediaType: "text/markdown", bytes: 5 });
    expect(
      (await readSkillResource(resolved, "assets/pixel.png")).text,
    ).toBeUndefined();
  });

  it.each(["", "../SKILL.md", "/tmp/file", "a\0b"])(
    "rejects unsafe paths: %s",
    async (path) => {
      const { resolved } = await setup();
      await expect(readSkillResource(resolved, path)).rejects.toMatchObject({
        code: "outside-root",
      });
    },
  );

  it("handles missing, directories, and byte limits", async () => {
    const { resolved } = await setup();
    await write(join(resolved.directory, "large.txt"), "12345");
    await expect(readSkillResource(resolved, "missing")).rejects.toMatchObject({
      code: "resource-not-found",
    });
    await expect(
      readSkillResource(resolved, "references"),
    ).rejects.toMatchObject({ code: "resource-not-found" });
    await expect(
      readSkillResource(resolved, "large.txt", { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: "resource-limit" });
    await expect(
      readSkillResource(resolved, "large.txt", { maxBytes: 0 }),
    ).rejects.toThrow(TypeError);
  });

  it("lists nested files deterministically without SKILL.md", async () => {
    const { resolved } = await setup();
    await write(join(resolved.directory, "scripts", "b.sh"), "b");
    await write(join(resolved.directory, "assets", "a.json"), "{}");
    const entries = await listSkillResources(resolved);
    expect(entries.map((entry) => entry.relativePath)).toEqual([
      "assets/a.json",
      "scripts/b.sh",
    ]);
  });

  it("enforces file, per-file, and total limits", async () => {
    const { resolved } = await setup();
    await write(join(resolved.directory, "a.txt"), "123");
    await write(join(resolved.directory, "b.txt"), "456");
    await expect(
      listSkillResources(resolved, { maxFiles: 1 }),
    ).rejects.toMatchObject({ code: "resource-limit" });
    await expect(
      listSkillResources(resolved, { maxBytes: 2 }),
    ).rejects.toMatchObject({ code: "resource-limit" });
    await expect(
      listSkillResources(resolved, { maxTotalBytes: 5 }),
    ).rejects.toMatchObject({ code: "resource-limit" });
    await expect(listSkillResources(resolved, { maxFiles: 0 })).rejects.toThrow(
      TypeError,
    );
  });

  it("blocks links, safely follows internal links, stops cycles, and rejects escapes", async () => {
    const { root, resolved } = await setup();
    await write(join(resolved.directory, "target.txt"), "safe");
    await symlink("target.txt", join(resolved.directory, "linked.txt"));
    await expect(
      readSkillResource(resolved, "linked.txt"),
    ).rejects.toMatchObject({ code: "symlink-blocked" });
    await expect(listSkillResources(resolved)).rejects.toMatchObject({
      code: "symlink-blocked",
    });
    expect(
      (
        await readSkillResource(resolved, "linked.txt", {
          followSymlinks: true,
        })
      ).text,
    ).toBe("safe");
    await symlink(".", join(resolved.directory, "cycle"));
    const listed = await listSkillResources(resolved, { followSymlinks: true });
    expect(listed.some((entry) => entry.relativePath === "linked.txt")).toBe(
      true,
    );
    const outside = await fixture();
    roots.push(outside);
    await write(join(outside, "secret.txt"), "secret");
    await symlink(
      join(outside, "secret.txt"),
      join(resolved.directory, "escape.txt"),
    );
    await expect(
      readSkillResource(resolved, "escape.txt", { followSymlinks: true }),
    ).rejects.toBeInstanceOf(SkillResourceError);
    await expect(
      listSkillResources(resolved, { followSymlinks: true }),
    ).rejects.toMatchObject({ code: "outside-root" });
    expect(root).not.toBe(outside);
  });

  it("detects links in parent path components during direct reads", async () => {
    const { resolved } = await setup();
    await write(join(resolved.directory, "real", "nested.txt"), "nested");
    await symlink("real", join(resolved.directory, "linked-directory"));
    await expect(
      readSkillResource(resolved, "linked-directory/nested.txt"),
    ).rejects.toMatchObject({ code: "symlink-blocked" });
    expect(
      (
        await readSkillResource(resolved, "linked-directory/nested.txt", {
          followSymlinks: true,
        })
      ).text,
    ).toBe("nested");
  });
});
