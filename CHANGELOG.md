# Changelog

## 0.1.1 - 2026-08-25

- Escape untrusted Markdown and XML prompt boundaries.
- Require exact frontmatter delimiters and string metadata keys.
- Bound candidate counts and aggregate `SKILL.md` bytes.
- Deduplicate cyclic discovery links before traversal.

## 0.1.0 - 2026-08-25

- Add spec-aware `SKILL.md` parsing and structured diagnostics.
- Add deterministic cross-agent discovery, precedence, linting, and explanation APIs.
- Add bounded, traversal-safe resource reading and enumeration.
- Add XML/Markdown prompt helpers and a dependency-light CLI.
- Ship ESM, CommonJS, and TypeScript declarations for Node.js 18+.
