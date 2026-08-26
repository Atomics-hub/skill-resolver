import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-resolver-"));
  await mkdir(join(root, ".git"));
  return root;
}

export async function write(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export function skill(
  name: string,
  description = `${name} description`,
  body = `# ${name}\n`,
): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}
