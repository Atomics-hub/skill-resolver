import { parseDocument } from "yaml";

import type {
  ParseSkillOptions,
  ParsedSkill,
  SkillIndexEntry,
  SkillIssue,
  SkillMetadata,
  SkillResolution,
  ResolvedSkill,
} from "./types.js";

const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseSkillContent(
  source: string,
  options: ParseSkillOptions = {},
): ParsedSkill {
  if (typeof source !== "string")
    throw new TypeError("source must be a string");
  if (
    options.maxBodyLines !== undefined &&
    (!Number.isInteger(options.maxBodyLines) || options.maxBodyLines <= 0)
  ) {
    throw new TypeError("maxBodyLines must be a positive integer");
  }
  if (
    options.unknownFields !== undefined &&
    !["ignore", "warn", "error"].includes(options.unknownFields)
  ) {
    throw new TypeError("unknownFields must be ignore, warn, or error");
  }
  const issues: SkillIssue[] = [];
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    issue(
      issues,
      "invalid-frontmatter",
      "error",
      "SKILL.md must start with YAML frontmatter",
      options.path,
    );
    return { ok: false, body: source, issues };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1 || !/^\n---(?:\n|$)/u.test(normalized.slice(end))) {
    issue(
      issues,
      "invalid-frontmatter",
      "error",
      "SKILL.md frontmatter is not closed",
      options.path,
    );
    return { ok: false, body: source, issues };
  }

  const header = normalized.slice(4, end);
  const bodyStart = end + (normalized.startsWith("\n---\n", end) ? 5 : 4);
  const body = normalized.slice(bodyStart);
  let value: unknown;
  try {
    const document = parseDocument(header, { uniqueKeys: true, merge: false });
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
    value = document.toJS({ maxAliasCount: 50 });
  } catch (error) {
    issue(
      issues,
      "invalid-yaml",
      "error",
      `Invalid YAML frontmatter: ${errorMessage(error)}`,
      options.path,
    );
    return { ok: false, body, issues };
  }

  if (!isRecord(value)) {
    issue(
      issues,
      "invalid-frontmatter",
      "error",
      "Skill frontmatter must be a mapping",
      options.path,
    );
    return { ok: false, body, issues };
  }

  validateUnknownFields(value, options, issues);
  const metadata = validateMetadata(value, options, issues);
  const maxBodyLines = options.maxBodyLines ?? 500;
  if (lineCount(body) > maxBodyLines) {
    issue(
      issues,
      "body-too-long",
      "warning",
      `Skill body has ${lineCount(body)} lines; recommended maximum is ${maxBodyLines}`,
      options.path,
    );
  }
  return {
    ok:
      metadata !== undefined &&
      !issues.some((entry) => entry.severity === "error"),
    ...(metadata === undefined ? {} : { metadata }),
    body,
    rawFrontmatter: value,
    issues,
  };
}

export function validateSkillContent(
  source: string,
  options: ParseSkillOptions = {},
): readonly SkillIssue[] {
  return parseSkillContent(source, options).issues;
}

export function buildSkillIndex(
  resolution: SkillResolution,
): readonly SkillIndexEntry[] {
  return resolution.skills.map((skill) => ({
    name: skill.metadata.name,
    description: skill.metadata.description,
    ...(skill.metadata.compatibility === undefined
      ? {}
      : { compatibility: skill.metadata.compatibility }),
    ...(skill.metadata.allowedTools === undefined
      ? {}
      : { allowedTools: skill.metadata.allowedTools }),
    path: skill.skillFile,
  }));
}

export function formatSkillIndex(
  resolution: SkillResolution,
  format: "markdown" | "xml" = "xml",
): string {
  const entries = buildSkillIndex(resolution);
  if (format === "markdown") {
    return entries
      .map((entry) => `- **${entry.name}**: ${entry.description}`)
      .join("\n");
  }
  const body = entries
    .map(
      (entry) =>
        `  <skill name="${escapeXml(entry.name)}" description="${escapeXml(entry.description)}" />`,
    )
    .join("\n");
  return `<available-skills>\n${body}\n</available-skills>`;
}

export function formatSkillPrompt(skill: ResolvedSkill): string {
  return [
    `<skill name="${escapeXml(skill.metadata.name)}">`,
    skill.body.trim(),
    "</skill>",
  ].join("\n");
}

function validateMetadata(
  value: Readonly<Record<string, unknown>>,
  options: ParseSkillOptions,
  issues: SkillIssue[],
): SkillMetadata | undefined {
  const name = value.name;
  const description = value.description;
  let valid = true;
  if (
    typeof name !== "string" ||
    name.length > 64 ||
    !NAME_PATTERN.test(name)
  ) {
    issue(
      issues,
      "invalid-name",
      "error",
      "name must be 1-64 lowercase alphanumeric/hyphen characters without edge or consecutive hyphens",
      options.path,
    );
    valid = false;
  }
  if (
    typeof description !== "string" ||
    description.length < 1 ||
    description.length > 1024
  ) {
    issue(
      issues,
      "invalid-description",
      "error",
      "description must be a non-empty string of at most 1024 characters",
      options.path,
    );
    valid = false;
  }
  if (
    typeof name === "string" &&
    options.expectedName !== undefined &&
    name !== options.expectedName
  ) {
    issue(
      issues,
      "name-directory-mismatch",
      "error",
      `Skill name ${name} does not match parent directory ${options.expectedName}`,
      options.path,
    );
    valid = false;
  }

  const compatibility = optionalString(
    value.compatibility,
    "compatibility",
    500,
    issues,
    options.path,
  );
  const license = optionalString(
    value.license,
    "license",
    undefined,
    issues,
    options.path,
  );
  const allowedTools = optionalString(
    value["allowed-tools"],
    "allowed-tools",
    undefined,
    issues,
    options.path,
  );
  const extraMetadata = validateExtraMetadata(
    value.metadata,
    issues,
    options.path,
  );
  if (
    compatibility === null ||
    license === null ||
    allowedTools === null ||
    extraMetadata === null
  ) {
    valid = false;
  }
  if (!valid || typeof name !== "string" || typeof description !== "string") {
    return undefined;
  }
  return {
    name,
    description,
    ...(typeof license === "string" ? { license } : {}),
    ...(typeof compatibility === "string" ? { compatibility } : {}),
    ...(extraMetadata !== undefined && extraMetadata !== null
      ? { metadata: extraMetadata }
      : {}),
    ...(typeof allowedTools === "string" ? { allowedTools } : {}),
  };
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number | undefined,
  issues: SkillIssue[],
  path: string | undefined,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (maxLength !== undefined && value.length > maxLength)
  ) {
    issue(
      issues,
      field === "compatibility"
        ? "invalid-compatibility"
        : "invalid-optional-field",
      "error",
      `${field} must be a non-empty string${maxLength === undefined ? "" : ` of at most ${maxLength} characters`}`,
      path,
    );
    return null;
  }
  return value;
}

function validateExtraMetadata(
  value: unknown,
  issues: SkillIssue[],
  path: string | undefined,
): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.values(value).some((entry) => typeof entry !== "string")
  ) {
    issue(
      issues,
      "invalid-metadata",
      "error",
      "metadata must map string keys to string values",
      path,
    );
    return null;
  }
  return value as Readonly<Record<string, string>>;
}

function validateUnknownFields(
  value: Readonly<Record<string, unknown>>,
  options: ParseSkillOptions,
  issues: SkillIssue[],
): void {
  const policy = options.unknownFields ?? "warn";
  if (policy === "ignore") return;
  for (const field of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(field)) {
      issue(
        issues,
        "unknown-field",
        policy === "error" ? "error" : "warning",
        `Unknown Agent Skills frontmatter field: ${field}`,
        options.path,
      );
    }
  }
}

function issue(
  issues: SkillIssue[],
  code: SkillIssue["code"],
  severity: SkillIssue["severity"],
  message: string,
  path: string | undefined,
): void {
  issues.push({
    code,
    severity,
    message,
    ...(path === undefined ? {} : { path }),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lineCount(value: string): number {
  return value === "" ? 0 : value.split("\n").length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
