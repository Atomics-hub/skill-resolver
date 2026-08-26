import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { parseSkillContent } from "./core.js";
import { getSkillProfile } from "./profiles.js";
import type {
  OmittedSkill,
  ResolveSkillsOptions,
  ResolvedSkill,
  SkillCandidate,
  SkillIssue,
  SkillLintResult,
  SkillLocation,
  SkillResolution,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_SKILL_BYTES = 1024 * 1024;

interface NormalizedOptions {
  cwd: string;
  root: string;
  profile: ReturnType<typeof getSkillProfile>;
  locations: readonly SkillLocation[];
  followSymlinks: boolean;
  maxDepth: number;
  maxSkillBytes: number;
  maxBodyLines: number;
  unknownFields: "ignore" | "warn" | "error";
  allowedRoots: readonly string[];
}

export async function findSkillRoot(start: string): Promise<string> {
  const original = resolve(start);
  let current = await targetDirectory(original);
  const fallback = current;
  for (;;) {
    if (await exists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

export async function discoverSkills(
  options: ResolveSkillsOptions = {},
): Promise<readonly SkillCandidate[]> {
  const normalized = await normalizeOptions(options);
  return discover(normalized, []);
}

export async function resolveSkills(
  options: ResolveSkillsOptions = {},
): Promise<SkillResolution> {
  const normalized = await normalizeOptions(options);
  const issues: SkillIssue[] = [];
  const omitted: OmittedSkill[] = [];
  const candidates = await discover(normalized, issues);
  const loaded: ResolvedSkill[] = [];

  for (const candidate of candidates) {
    const content = await readSkillFile(
      candidate.skillFile,
      normalized,
      issues,
    );
    if (content === null) {
      omitted.push({ ...candidate, reason: "unsafe", issues: [] });
      continue;
    }
    const parsed = parseSkillContent(content, {
      path: candidate.skillFile,
      expectedName: basename(candidate.directory),
      maxBodyLines: normalized.maxBodyLines,
      unknownFields: normalized.unknownFields,
    });
    issues.push(...parsed.issues);
    if (!parsed.ok || parsed.metadata === undefined) {
      omitted.push({
        ...candidate,
        reason: "invalid",
        ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        issues: parsed.issues,
      });
      continue;
    }
    loaded.push({
      ...candidate,
      metadata: parsed.metadata,
      body: parsed.body,
      issues: parsed.issues,
    });
  }

  const selected = new Map<string, ResolvedSkill>();
  for (const skill of loaded) {
    const existing = selected.get(skill.metadata.name);
    if (existing !== undefined) {
      const collision: SkillIssue = {
        code: "duplicate-skill",
        severity: "warning",
        message: `Multiple skills declare the name ${skill.metadata.name}`,
        path: skill.skillFile,
        relatedPath: existing.skillFile,
      };
      const shadow: SkillIssue = {
        code: "shadowed-skill",
        severity: "info",
        message: `${displayPath(normalized.root, existing.skillFile)} is shadowed by ${displayPath(normalized.root, skill.skillFile)}`,
        path: existing.skillFile,
        relatedPath: skill.skillFile,
      };
      issues.push(collision, shadow);
      omitted.push({
        ...existing,
        reason: "shadowed",
        metadata: existing.metadata,
        issues: [collision, shadow],
      });
    }
    selected.set(skill.metadata.name, skill);
  }

  return {
    root: normalized.root,
    profile: normalized.profile.name,
    skills: [...selected.values()].sort((left, right) =>
      left.metadata.name.localeCompare(right.metadata.name),
    ),
    omitted,
    issues,
  };
}

export async function lintSkills(
  options: ResolveSkillsOptions & { strict?: boolean } = {},
): Promise<SkillLintResult> {
  const resolution = await resolveSkills(options);
  const errorCount = resolution.issues.filter(
    (entry) => entry.severity === "error",
  ).length;
  const warningCount = resolution.issues.filter(
    (entry) => entry.severity === "warning",
  ).length;
  return {
    resolution,
    errorCount,
    warningCount,
    ok: errorCount === 0 && (!(options.strict ?? false) || warningCount === 0),
  };
}

export function getResolvedSkill(
  resolution: SkillResolution,
  name: string,
): ResolvedSkill | undefined {
  return resolution.skills.find((skill) => skill.metadata.name === name);
}

export function explainSkills(resolution: SkillResolution): string {
  const lines = [
    `Profile: ${resolution.profile}`,
    `Root: ${resolution.root}`,
    `Resolved: ${resolution.skills.length} skill(s)`,
  ];
  for (const skill of resolution.skills) {
    lines.push(
      `  + ${skill.metadata.name} (${displayPath(resolution.root, skill.skillFile)}) [${skill.origin}; priority ${skill.priority}]`,
    );
  }
  for (const entry of resolution.omitted) {
    lines.push(
      `  - ${displayPath(resolution.root, entry.skillFile)} [${entry.reason}]`,
    );
  }
  for (const entry of resolution.issues) {
    lines.push(`  ! ${entry.severity} ${entry.code}: ${entry.message}`);
  }
  return `${lines.join("\n")}\n`;
}

async function normalizeOptions(
  options: ResolveSkillsOptions,
): Promise<NormalizedOptions> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(options.root ?? (await findSkillRoot(cwd)));
  const profile = getSkillProfile(options.profile);
  const projectLocations = profile.projectLocations.map((path, index) => ({
    path: resolveLocation(root, path),
    origin: "project" as const,
    priority: 1_000 + index,
  }));
  const globalPaths = options.globalLocations ?? profile.globalLocations ?? [];
  const globalLocations = options.includeGlobal
    ? globalPaths.map((path, index) => ({
        path: resolveLocation(root, path),
        origin: "global" as const,
        priority: index,
      }))
    : [];
  const customLocations = (options.locations ?? []).map((path, index) => ({
    path: resolve(isAbsolute(path) ? path : join(cwd, path)),
    origin: "custom" as const,
    priority: 2_000 + index,
  }));
  const locations = dedupeLocations([
    ...globalLocations,
    ...projectLocations,
    ...customLocations,
  ]);
  const canonical = await Promise.all(
    locations.map((entry) => canonicalPath(entry.path)),
  );
  const unknownFields = options.unknownFields ?? "warn";
  if (!["ignore", "warn", "error"].includes(unknownFields)) {
    throw new TypeError("unknownFields must be ignore, warn, or error");
  }
  return {
    cwd,
    root,
    profile,
    locations,
    followSymlinks: options.followSymlinks ?? false,
    maxDepth: nonNegativeInteger(
      options.maxDepth ?? DEFAULT_MAX_DEPTH,
      "maxDepth",
    ),
    maxSkillBytes: positiveInteger(
      options.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES,
      "maxSkillBytes",
    ),
    maxBodyLines: positiveInteger(options.maxBodyLines ?? 500, "maxBodyLines"),
    unknownFields,
    allowedRoots: [
      ...new Set([...locations.map((entry) => entry.path), ...canonical]),
    ],
  };
}

async function discover(
  options: NormalizedOptions,
  issues: SkillIssue[],
): Promise<SkillCandidate[]> {
  const candidates = new Map<string, SkillCandidate>();
  for (const location of options.locations) {
    await walkLocation(location, options, candidates, issues);
  }
  return [...candidates.values()].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.directory.localeCompare(right.directory),
  );
}

async function walkLocation(
  location: SkillLocation,
  options: NormalizedOptions,
  output: Map<string, SkillCandidate>,
  issues: SkillIssue[],
): Promise<void> {
  if (!(await exists(location.path))) return;
  const queue: Array<{ path: string; depth: number }> = [
    { path: location.path, depth: 0 },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    const metadata = await safeLstat(current.path);
    if (metadata === null) continue;
    if (metadata.isSymbolicLink()) {
      if (!options.followSymlinks) {
        issues.push({
          code: "symlink-blocked",
          severity: "error",
          message: `Blocked symbolic link during skill discovery: ${current.path}`,
          path: current.path,
        });
        continue;
      }
      const canonical = await canonicalPath(current.path);
      if (!options.allowedRoots.some((root) => isWithin(root, canonical))) {
        issues.push({
          code: "outside-root",
          severity: "error",
          message: `Skill directory link resolves outside allowed roots: ${current.path}`,
          path: current.path,
          relatedPath: canonical,
        });
        continue;
      }
    }
    const skillFile = join(current.path, "SKILL.md");
    if (await exists(skillFile)) {
      const key = await canonicalPath(current.path);
      output.set(key, { ...location, directory: current.path, skillFile });
      continue;
    }
    if (current.depth >= options.maxDepth) continue;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch (error) {
      issues.push({
        code: "read-failed",
        severity: "warning",
        message: `Could not inspect skill directory ${current.path}: ${errorMessage(error)}`,
        path: current.path,
      });
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        queue.push({
          path: join(current.path, entry.name),
          depth: current.depth + 1,
        });
      }
    }
  }
}

async function readSkillFile(
  path: string,
  options: NormalizedOptions,
  issues: SkillIssue[],
): Promise<string | null> {
  try {
    const linkMetadata = await lstat(path);
    let readPath = path;
    if (linkMetadata.isSymbolicLink()) {
      if (!options.followSymlinks) {
        issues.push({
          code: "symlink-blocked",
          severity: "error",
          message: `Blocked symbolic link: ${path}`,
          path,
        });
        return null;
      }
      readPath = await realpath(path);
      if (!options.allowedRoots.some((root) => isWithin(root, readPath))) {
        issues.push({
          code: "outside-root",
          severity: "error",
          message: `Skill file link resolves outside allowed roots: ${path}`,
          path,
          relatedPath: readPath,
        });
        return null;
      }
    }
    const fileMetadata = await stat(readPath);
    if (!fileMetadata.isFile()) throw new Error("not a regular file");
    if (fileMetadata.size > options.maxSkillBytes) {
      issues.push({
        code: "file-too-large",
        severity: "error",
        message: `${path} exceeds maxSkillBytes`,
        path,
      });
      return null;
    }
    const content = await readFile(readPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > options.maxSkillBytes) {
      issues.push({
        code: "file-too-large",
        severity: "error",
        message: `${path} grew beyond maxSkillBytes while reading`,
        path,
      });
      return null;
    }
    return content;
  } catch (error) {
    issues.push({
      code: "read-failed",
      severity: "error",
      message: `Could not read ${path}: ${errorMessage(error)}`,
      path,
    });
    return null;
  }
}

function dedupeLocations(locations: readonly SkillLocation[]): SkillLocation[] {
  const result = new Map<string, SkillLocation>();
  for (const location of locations) result.set(location.path, location);
  return [...result.values()].sort(
    (left, right) => left.priority - right.priority,
  );
}

function resolveLocation(root: string, path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(isAbsolute(path) ? path : join(root, path));
}

async function targetDirectory(path: string): Promise<string> {
  try {
    const metadata = await stat(path);
    return metadata.isDirectory() ? path : dirname(path);
  } catch {
    return extname(path) === "" ? path : dirname(path);
  }
}

async function safeLstat(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await safeLstat(path)) !== null;
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function displayPath(root: string, path: string): string {
  const value = relative(root, path);
  return (value === "" ? "." : value).replaceAll(sep, "/");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
