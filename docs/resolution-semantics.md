# Resolution semantics

Locations receive increasing priority in this order:

1. enabled global profile locations;
2. project profile locations;
3. explicit custom locations.

Within a group, later locations have higher priority. Canonically identical directories are coalesced. When multiple valid skills declare the same name, the higher-priority skill is selected; lower-priority instances remain in `omitted` with `shadowed` provenance and duplicate diagnostics.

Discovery is breadth-first and lexical within each directory. A directory containing `SKILL.md` is a skill root and is not traversed further. This prevents bundled resources from being mistaken for nested skills.

Invalid and unsafe candidates never shadow a valid skill. `resolveSkills` reports them as omitted with their diagnostics.
