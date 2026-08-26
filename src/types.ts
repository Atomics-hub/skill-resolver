export type SkillProfileName =
  "claude" | "codex" | "copilot" | "cursor" | "gemini" | "universal";

export type SkillIssueSeverity = "info" | "warning" | "error";

export type SkillIssueCode =
  | "body-too-long"
  | "duplicate-skill"
  | "file-too-large"
  | "invalid-compatibility"
  | "invalid-description"
  | "invalid-frontmatter"
  | "invalid-metadata"
  | "invalid-name"
  | "invalid-optional-field"
  | "invalid-yaml"
  | "missing-skill-file"
  | "name-directory-mismatch"
  | "outside-root"
  | "read-failed"
  | "resource-limit"
  | "resource-not-found"
  | "shadowed-skill"
  | "symlink-blocked"
  | "unknown-field";

export interface SkillIssue {
  code: SkillIssueCode;
  severity: SkillIssueSeverity;
  message: string;
  path?: string;
  relatedPath?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Readonly<Record<string, string>>;
  allowedTools?: string;
}

export interface ParsedSkill {
  ok: boolean;
  metadata?: SkillMetadata;
  body: string;
  rawFrontmatter?: Readonly<Record<string, unknown>>;
  issues: readonly SkillIssue[];
}

export interface ParseSkillOptions {
  path?: string;
  expectedName?: string;
  maxBodyLines?: number;
  unknownFields?: "ignore" | "warn" | "error";
}

export interface SkillLocation {
  path: string;
  origin: "project" | "global" | "custom";
  priority: number;
}

export interface SkillProfile {
  name: string;
  projectLocations: readonly string[];
  globalLocations?: readonly string[];
}

export interface SkillCandidate extends SkillLocation {
  directory: string;
  skillFile: string;
}

export interface ResolvedSkill extends SkillCandidate {
  metadata: SkillMetadata;
  body: string;
  issues: readonly SkillIssue[];
}

export interface OmittedSkill extends SkillCandidate {
  reason: "invalid" | "shadowed" | "unsafe";
  metadata?: SkillMetadata;
  issues: readonly SkillIssue[];
}

export interface SkillResolution {
  root: string;
  profile: string;
  skills: readonly ResolvedSkill[];
  omitted: readonly OmittedSkill[];
  issues: readonly SkillIssue[];
}

export interface ResolveSkillsOptions {
  cwd?: string;
  root?: string;
  profile?: SkillProfileName | SkillProfile;
  locations?: readonly string[];
  includeGlobal?: boolean;
  globalLocations?: readonly string[];
  followSymlinks?: boolean;
  maxDepth?: number;
  maxSkillBytes?: number;
  maxBodyLines?: number;
  unknownFields?: "ignore" | "warn" | "error";
}

export interface SkillIndexEntry {
  name: string;
  description: string;
  compatibility?: string;
  allowedTools?: string;
  path: string;
}

export interface SkillResource {
  skill: string;
  path: string;
  relativePath: string;
  bytes: number;
  mediaType: string;
  data: Uint8Array;
  text?: string;
}

export interface SkillResourceOptions {
  followSymlinks?: boolean;
  maxBytes?: number;
}

export interface ListSkillResourcesOptions extends SkillResourceOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
}

export interface SkillResourceEntry {
  path: string;
  relativePath: string;
  bytes: number;
  mediaType: string;
}

export interface SkillLintResult {
  resolution: SkillResolution;
  ok: boolean;
  errorCount: number;
  warningCount: number;
}
