# skill-resolver

Discover, validate, resolve, and safely load Agent Skills across coding agents.

[![npm version](https://img.shields.io/npm/v/skill-resolver.svg)](https://www.npmjs.com/package/skill-resolver)
[![CI](https://github.com/Atomics-hub/skill-resolver/actions/workflows/ci.yml/badge.svg)](https://github.com/Atomics-hub/skill-resolver/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/skill-resolver.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/skill-resolver.svg)](./package.json)

Agent Skills are portable folders built around a `SKILL.md` file, but real projects spread them across `skills/`, `.agents/skills/`, `.claude/skills/`, `.github/skills/`, `.codex/skills/`, `.cursor/skills/`, and `.gemini/skills/`. `skill-resolver` gives runtimes, editors, registries, CI, and prompt builders one deterministic TypeScript API and CLI for that ecosystem.

```sh
npm install skill-resolver
```

```ts
import {
  resolveSkills,
  formatSkillIndex,
  readSkillResource,
} from "skill-resolver";

const resolution = await resolveSkills({
  root: process.cwd(),
  profile: "universal",
});

console.log(formatSkillIndex(resolution));

const deploy = resolution.skills.find(
  (entry) => entry.metadata.name === "deploy",
);
if (deploy) {
  const reference = await readSkillResource(deploy, "references/provider.md");
  console.log(reference.text);
}
```

## Why this exists

A folder containing malformed YAML can disappear silently in one tool and load in another. Duplicate skill names can change behavior based on filesystem order. Resource helpers can accidentally permit `../` traversal or links outside a skill. Vendor-specific discovery rules make portable integrations harder than they need to be.

This package provides:

- spec-aware parsing and diagnostics for every standard frontmatter field;
- built-in Claude, Codex, Copilot, Cursor, Gemini, and universal profiles;
- deterministic global → project → custom precedence with a full shadow trace;
- global discovery disabled by default, so a project scan stays project-scoped;
- explicit depth, file-size, resource-count, and total-byte limits;
- safe resource loading with traversal protection and symlinks blocked by default;
- Markdown/XML prompt indexes plus machine-readable resolution data;
- ESM, CommonJS, TypeScript declarations, and a dependency-light Node.js 18+ runtime.

## CLI

```sh
# List available skills as an XML prompt index
npx skill-resolver

# Explain discovery, precedence, invalid files, and shadowed skills
npx skill-resolver explain

# Validate a repository; warnings fail with --strict
npx skill-resolver lint --strict

# Print one skill body or safely read one of its resources
npx skill-resolver show deploy
npx skill-resolver read deploy references/provider.md

# Use one vendor profile and emit integration-friendly JSON
npx skill-resolver list --profile claude --json
```

Run `skill-resolver --help` for all limits and discovery options.

## API

### `resolveSkills(options?)`

Returns `{ root, profile, skills, omitted, issues }`. Valid skills are sorted by name. Duplicate names resolve by priority: profile global locations first, then project locations, then explicit `locations`; later locations in each group win. Every collision remains visible in `omitted` and `issues`.

```ts
const result = await resolveSkills({
  cwd: process.cwd(),
  root: process.cwd(),
  profile: "universal",
  locations: ["./company-skills"],
  includeGlobal: false,
  followSymlinks: false,
  maxDepth: 2,
  maxSkills: 10_000,
  maxSkillBytes: 1_048_576,
  maxTotalSkillBytes: 26_214_400,
  maxBodyLines: 500,
  unknownFields: "warn",
});
```

If `root` is omitted, the nearest ancestor containing `.git` is selected. If no marker exists, the starting directory is used.

### `discoverSkills(options?)`

Discovers candidates without parsing their contents. Use it for watchers and cache invalidation.

### `lintSkills(options?)`

Returns `{ ok, errorCount, warningCount, resolution }`. Errors fail normally; `strict: true` also fails warnings.

### `parseSkillContent(source, options?)`

Parses one `SKILL.md` string and returns normalized camel-case metadata, body text, raw frontmatter, and structured issues. It rejects duplicate YAML keys, alias abuse, invalid names, directory/name mismatches, non-string metadata values, and malformed optional fields.

### `readSkillResource(skill, path, options?)`

Reads one relative resource with a per-file byte limit. Absolute paths, NUL bytes, traversal, and escaping links are rejected. Text formats include a decoded `text` field; binary resources remain bytes.

### `listSkillResources(skill, options?)`

Lists nested resources deterministically with per-file, file-count, and total-byte budgets. Directory link cycles terminate safely.

### Prompt helpers

`buildSkillIndex`, `formatSkillIndex`, and `formatSkillPrompt` expose progressively disclosed metadata/body formats with XML escaping.

## Profiles

| Profile     | Extra project location | Extra global location |
| ----------- | ---------------------- | --------------------- |
| `claude`    | `.claude/skills`       | `~/.claude/skills`    |
| `codex`     | `.codex/skills`        | `~/.codex/skills`     |
| `copilot`   | `.github/skills`       | —                     |
| `cursor`    | `.cursor/skills`       | `~/.cursor/skills`    |
| `gemini`    | `.gemini/skills`       | `~/.gemini/skills`    |
| `universal` | all of the above       | all of the above      |

Every profile also checks project `skills/` and `.agents/skills/`. Global discovery is opt-in with `includeGlobal: true` or `--global`. Profiles are deterministic compatibility presets, not claims that each vendor's private implementation is identical.

Custom profiles are accepted by the API:

```ts
await resolveSkills({
  profile: {
    name: "my-runtime",
    projectLocations: ["skills", ".my-agent/skills"],
    globalLocations: ["~/.my-agent/skills"],
  },
});
```

## Security model

Skills are untrusted input. `skill-resolver` only reads and returns content; it never executes scripts, interprets instructions, or sends data to a model. Links are blocked unless explicitly enabled, and enabled links must resolve within a configured discovery root or the selected skill root. See [Security model](./docs/security-model.md).

## Performance

Discovery is breadth-first, bounded by `maxDepth`, and stops descending once a skill root is found. Canonical paths deduplicate aliases. The release suite resolves 1,000 skills and enumerates a large resource tree under a ten-second ceiling, alongside property, traversal, link-cycle, packed ESM/CommonJS, CLI, and Node 18 runtime checks.

## License

MIT © Atomics Hub
