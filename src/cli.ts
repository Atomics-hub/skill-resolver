#!/usr/bin/env node

import { stdout, stderr } from "node:process";

import {
  explainSkills,
  formatSkillIndex,
  getResolvedSkill,
  lintSkills,
  readSkillResource,
  resolveSkills,
} from "./index.js";
import type { ResolveSkillsOptions, SkillProfileName } from "./types.js";

const VERSION = "0.1.1";
const PROFILE_NAMES = new Set([
  "claude",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "universal",
]);

interface CliOptions extends ResolveSkillsOptions {
  json: boolean;
  strict: boolean;
  format: "markdown" | "xml";
}

async function main(argv: readonly string[]): Promise<number> {
  const { command, positionals, options } = parseArguments(argv);
  if (command === "help") {
    stdout.write(help());
    return 0;
  }
  if (command === "version") {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command === "lint") {
    const result = await lintSkills({
      ...resolverOptions(options),
      strict: options.strict,
    });
    if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      stdout.write(explainSkills(result.resolution));
      stdout.write(
        `Lint: ${result.errorCount} error(s), ${result.warningCount} warning(s)\n`,
      );
    }
    return result.ok ? 0 : 1;
  }

  const resolution = await resolveSkills(resolverOptions(options));
  if (command === "list") {
    if (options.json) stdout.write(`${JSON.stringify(resolution, null, 2)}\n`);
    else stdout.write(`${formatSkillIndex(resolution, options.format)}\n`);
    return resolution.issues.some((issue) => issue.severity === "error")
      ? 1
      : 0;
  }
  if (command === "explain") {
    stdout.write(
      options.json
        ? `${JSON.stringify(resolution, null, 2)}\n`
        : explainSkills(resolution),
    );
    return resolution.issues.some((issue) => issue.severity === "error")
      ? 1
      : 0;
  }

  const name = required(positionals[0], `${command} requires a skill name`);
  const skill = getResolvedSkill(resolution, name);
  if (skill === undefined)
    throw new CliError(`Unknown or invalid skill: ${name}`);
  if (command === "show") {
    stdout.write(
      options.json
        ? `${JSON.stringify(skill, null, 2)}\n`
        : `${skill.body.replace(/\s+$/u, "")}\n`,
    );
    return 0;
  }
  if (command === "read") {
    const resourcePath = required(
      positionals[1],
      "read requires a resource path",
    );
    const resource = await readSkillResource(skill, resourcePath, {
      ...(options.followSymlinks === undefined
        ? {}
        : { followSymlinks: options.followSymlinks }),
      ...(options.maxSkillBytes === undefined
        ? {}
        : { maxBytes: options.maxSkillBytes }),
    });
    if (options.json) {
      stdout.write(
        `${JSON.stringify({ ...resource, data: Buffer.from(resource.data).toString("base64") }, null, 2)}\n`,
      );
    } else {
      stdout.write(Buffer.from(resource.data));
    }
    return 0;
  }
  throw new CliError(`Unknown command: ${command}`);
}

function parseArguments(argv: readonly string[]): {
  command: string;
  positionals: string[];
  options: CliOptions;
} {
  const options: CliOptions = {
    json: false,
    strict: false,
    format: "xml",
    locations: [],
  };
  const positionals: string[] = [];
  let command = "list";
  let commandSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (argument === "-h" || argument === "--help")
      return { command: "help", positionals, options };
    if (argument === "-v" || argument === "--version")
      return { command: "version", positionals, options };
    if (argument === "--json") options.json = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--global") options.includeGlobal = true;
    else if (argument === "--follow-symlinks") options.followSymlinks = true;
    else if (argument === "--cwd") options.cwd = next(argv, ++index, argument);
    else if (argument === "--root")
      options.root = next(argv, ++index, argument);
    else if (argument === "--location")
      options.locations = [
        ...(options.locations ?? []),
        next(argv, ++index, argument),
      ];
    else if (argument === "--profile") {
      const profile = next(argv, ++index, argument);
      if (!PROFILE_NAMES.has(profile))
        throw new CliError(`Unknown profile: ${profile}`);
      options.profile = profile as SkillProfileName;
    } else if (argument === "--format") {
      const format = next(argv, ++index, argument);
      if (format !== "xml" && format !== "markdown")
        throw new CliError("--format must be xml or markdown");
      options.format = format;
    } else if (argument === "--unknown-fields") {
      const policy = next(argv, ++index, argument);
      if (policy !== "ignore" && policy !== "warn" && policy !== "error")
        throw new CliError("--unknown-fields must be ignore, warn, or error");
      options.unknownFields = policy;
    } else if (argument === "--max-depth")
      options.maxDepth = number(next(argv, ++index, argument), argument, true);
    else if (argument === "--max-skills")
      options.maxSkills = number(
        next(argv, ++index, argument),
        argument,
        false,
      );
    else if (argument === "--max-skill-bytes")
      options.maxSkillBytes = number(
        next(argv, ++index, argument),
        argument,
        false,
      );
    else if (argument === "--max-total-skill-bytes")
      options.maxTotalSkillBytes = number(
        next(argv, ++index, argument),
        argument,
        false,
      );
    else if (argument === "--max-body-lines")
      options.maxBodyLines = number(
        next(argv, ++index, argument),
        argument,
        false,
      );
    else if (argument.startsWith("-"))
      throw new CliError(`Unknown option: ${argument}`);
    else if (
      !commandSet &&
      ["list", "show", "read", "lint", "explain"].includes(argument)
    ) {
      command = argument;
      commandSet = true;
    } else positionals.push(argument);
  }
  return { command, positionals, options };
}

function resolverOptions(options: CliOptions): ResolveSkillsOptions {
  const resolver: Partial<CliOptions> = { ...options };
  delete resolver.json;
  delete resolver.strict;
  delete resolver.format;
  return resolver;
}

function next(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--"))
    throw new CliError(`${option} requires a value`);
  return value;
}

function number(value: string, option: string, allowZero: boolean): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1))
    throw new CliError(
      `${option} requires ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  return parsed;
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value === "") throw new CliError(message);
  return value;
}

function help(): string {
  return `skill-resolver ${VERSION}\n\nDiscover, validate, resolve, and safely load Agent Skills.\n\nUsage:\n  skill-resolver [list] [options]\n  skill-resolver show <name> [options]\n  skill-resolver read <name> <resource> [options]\n  skill-resolver lint [--strict] [options]\n  skill-resolver explain [options]\n\nOptions:\n  --profile <name>         claude, codex, copilot, cursor, gemini, universal\n  --cwd <path>             Starting directory\n  --root <path>            Project root override\n  --location <path>        Extra skill location (repeatable; highest priority)\n  --global                 Include profile global locations\n  --follow-symlinks        Follow links only when they stay inside allowed roots\n  --max-depth <number>     Discovery depth (default: 2)\n  --max-skills <number>    Maximum discovered skills (default: 10000)\n  --max-skill-bytes <n>    Maximum SKILL.md/resource bytes (default: 1048576)\n  --max-total-skill-bytes <n>  Aggregate SKILL.md bytes (default: 26214400)\n  --max-body-lines <n>     Recommended body limit (default: 500)\n  --unknown-fields <mode>  ignore, warn, error (default: warn)\n  --format <format>        xml or markdown for list output\n  --json                   Machine-readable output\n  --strict                 Treat warnings as lint failures\n  -h, --help               Show help\n  -v, --version            Show version\n`;
}

class CliError extends Error {}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    stderr.write(
      `skill-resolver: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
