import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  ListSkillResourcesOptions,
  ResolvedSkill,
  SkillResource,
  SkillResourceEntry,
  SkillResourceOptions,
} from "./types.js";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export class SkillResourceError extends Error {
  override readonly name = "SkillResourceError";
  constructor(
    readonly code:
      | "outside-root"
      | "resource-not-found"
      | "resource-limit"
      | "symlink-blocked",
    message: string,
  ) {
    super(message);
  }
}

export async function readSkillResource(
  skill: ResolvedSkill,
  resourcePath: string,
  options: SkillResourceOptions = {},
): Promise<SkillResource> {
  const absolute = safeResourcePath(skill.directory, resourcePath);
  const readPath = await safeReadPath(
    skill.directory,
    absolute,
    options.followSymlinks ?? false,
  );
  let metadata;
  try {
    metadata = await stat(readPath);
  } catch {
    throw new SkillResourceError(
      "resource-not-found",
      `Skill resource not found: ${resourcePath}`,
    );
  }
  if (!metadata.isFile()) {
    throw new SkillResourceError(
      "resource-not-found",
      `Skill resource is not a file: ${resourcePath}`,
    );
  }
  const maxBytes = positiveInteger(
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    "maxBytes",
  );
  if (metadata.size > maxBytes) {
    throw new SkillResourceError(
      "resource-limit",
      `Skill resource exceeds ${maxBytes} bytes: ${resourcePath}`,
    );
  }
  const data = await readFile(readPath);
  if (data.byteLength > maxBytes) {
    throw new SkillResourceError(
      "resource-limit",
      `Skill resource grew beyond ${maxBytes} bytes: ${resourcePath}`,
    );
  }
  const mediaType = mediaTypeFor(resourcePath);
  return {
    skill: skill.metadata.name,
    path: readPath,
    relativePath: normalizeRelative(relative(skill.directory, absolute)),
    bytes: data.byteLength,
    mediaType,
    data,
    ...(isTextMediaType(mediaType) ? { text: data.toString("utf8") } : {}),
  };
}

export async function listSkillResources(
  skill: ResolvedSkill,
  options: ListSkillResourcesOptions = {},
): Promise<readonly SkillResourceEntry[]> {
  const maxFiles = positiveInteger(
    options.maxFiles ?? DEFAULT_MAX_FILES,
    "maxFiles",
  );
  const maxBytes = positiveInteger(
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    "maxBytes",
  );
  const maxTotalBytes = positiveInteger(
    options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
  );
  const followSymlinks = options.followSymlinks ?? false;
  const output: SkillResourceEntry[] = [];
  const queue: Array<{ readPath: string; displayPath: string }> = [
    { readPath: skill.directory, displayPath: skill.directory },
  ];
  const visited = new Set<string>();
  let totalBytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined) continue;
    const canonicalDirectory = await realpath(directory.readPath);
    if (visited.has(canonicalDirectory)) continue;
    visited.add(canonicalDirectory);
    let entries;
    try {
      entries = await readdir(directory.readPath, { withFileTypes: true });
    } catch {
      throw new SkillResourceError(
        "resource-not-found",
        `Could not inspect skill resource directory: ${directory.displayPath}`,
      );
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory.readPath, entry.name);
      const displayPath = join(directory.displayPath, entry.name);
      if (entry.isSymbolicLink()) {
        if (!followSymlinks) {
          throw new SkillResourceError(
            "symlink-blocked",
            `Blocked symbolic link in skill: ${absolute}`,
          );
        }
        const canonical = await safeReadPath(skill.directory, absolute, true);
        const metadata = await stat(canonical);
        if (metadata.isDirectory())
          queue.push({ readPath: canonical, displayPath });
        else if (metadata.isFile())
          addResource(canonical, displayPath, metadata.size);
      } else if (entry.isDirectory()) {
        queue.push({ readPath: absolute, displayPath });
      } else if (entry.isFile() && absolute !== skill.skillFile) {
        const metadata = await stat(absolute);
        addResource(absolute, displayPath, metadata.size);
      }
    }
  }
  return output;

  function addResource(
    readPath: string,
    displayPath: string,
    bytes: number,
  ): void {
    if (bytes > maxBytes) {
      throw new SkillResourceError(
        "resource-limit",
        `Skill resource exceeds ${maxBytes} bytes: ${displayPath}`,
      );
    }
    if (output.length >= maxFiles) {
      throw new SkillResourceError(
        "resource-limit",
        `Skill exceeds ${maxFiles} resource files`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      throw new SkillResourceError(
        "resource-limit",
        `Skill resources exceed ${maxTotalBytes} total bytes`,
      );
    }
    output.push({
      path: readPath,
      relativePath: normalizeRelative(relative(skill.directory, displayPath)),
      bytes,
      mediaType: mediaTypeFor(displayPath),
    });
  }
}

function safeResourcePath(root: string, path: string): string {
  if (path === "" || path.includes("\0") || isAbsolute(path)) {
    throw new SkillResourceError(
      "outside-root",
      `Unsafe skill resource path: ${path}`,
    );
  }
  const absolute = resolve(root, path);
  if (!isWithin(root, absolute)) {
    throw new SkillResourceError(
      "outside-root",
      `Skill resource escapes its root: ${path}`,
    );
  }
  return absolute;
}

async function safeReadPath(
  root: string,
  path: string,
  followSymlinks: boolean,
): Promise<string> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new SkillResourceError(
      "resource-not-found",
      `Skill resource not found: ${path}`,
    );
  }
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(path);
  const expected = resolve(
    canonicalRoot,
    relative(resolve(root), resolve(path)),
  );
  const traversesLink = metadata.isSymbolicLink() || canonical !== expected;
  if (traversesLink && !followSymlinks) {
    throw new SkillResourceError(
      "symlink-blocked",
      `Blocked symbolic link: ${path}`,
    );
  }
  if (!isWithin(canonicalRoot, canonical)) {
    throw new SkillResourceError(
      "outside-root",
      `Symbolic link escapes skill root: ${path}`,
    );
  }
  return traversesLink ? canonical : path;
}

function mediaTypeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return (
    (
      {
        ".css": "text/css",
        ".csv": "text/csv",
        ".gif": "image/gif",
        ".html": "text/html",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".js": "text/javascript",
        ".json": "application/json",
        ".md": "text/markdown",
        ".mjs": "text/javascript",
        ".png": "image/png",
        ".py": "text/x-python",
        ".sh": "text/x-shellscript",
        ".svg": "image/svg+xml",
        ".toml": "application/toml",
        ".ts": "text/typescript",
        ".txt": "text/plain",
        ".yaml": "application/yaml",
        ".yml": "application/yaml",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}

function isTextMediaType(value: string): boolean {
  return (
    value.startsWith("text/") ||
    ["application/json", "application/toml", "application/yaml"].includes(value)
  );
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function normalizeRelative(value: string): string {
  return value.replaceAll(sep, "/");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer`);
  return value;
}
