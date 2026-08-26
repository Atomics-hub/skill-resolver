# Security model

Treat every skill directory as untrusted input.

`skill-resolver` discovers files, parses YAML, and returns metadata, Markdown, or bytes. It never runs files from `scripts/`, evaluates Markdown, invokes tools named by `allowed-tools`, or sends content over the network.

## Default boundaries

- Global locations are excluded unless `includeGlobal` is explicitly enabled.
- Symbolic links are rejected unless `followSymlinks` is explicitly enabled.
- Followed discovery links must resolve within a configured discovery location.
- Followed resource links must resolve within the selected skill directory.
- Resource paths must be relative and cannot contain NUL bytes or escape with `..`.
- `SKILL.md`, individual resources, resource counts, and aggregate resource bytes are bounded.
- YAML duplicate keys, merge keys, and excessive aliases are rejected.
- Resource-directory cycles are canonicalized and visited once.

These controls reduce accidental data disclosure and denial-of-service risk. They do not make skill prose trustworthy. A host must decide whether and how a model may act on returned content.

## Race conditions

Filesystem contents can change between validation and reading. Size is checked before and after each actual file read. For hostile multi-user filesystems, run the host in a sandbox with OS-level filesystem restrictions; path checks are defense in depth, not a replacement for isolation.

## Reporting

Please report suspected vulnerabilities privately through GitHub Security Advisories. Do not include secrets or exploit unrelated systems.
