import type { SkillProfile, SkillProfileName } from "./types.js";

const standardProject = ["skills", ".agents/skills"] as const;
const standardGlobal = ["~/.config/agents/skills", "~/.agents/skills"] as const;

const profiles: Record<SkillProfileName, SkillProfile> = {
  claude: {
    name: "claude",
    projectLocations: [...standardProject, ".claude/skills"],
    globalLocations: [...standardGlobal, "~/.claude/skills"],
  },
  codex: {
    name: "codex",
    projectLocations: [...standardProject, ".codex/skills"],
    globalLocations: [...standardGlobal, "~/.codex/skills"],
  },
  copilot: {
    name: "copilot",
    projectLocations: [...standardProject, ".github/skills"],
    globalLocations: standardGlobal,
  },
  cursor: {
    name: "cursor",
    projectLocations: [...standardProject, ".cursor/skills"],
    globalLocations: [...standardGlobal, "~/.cursor/skills"],
  },
  gemini: {
    name: "gemini",
    projectLocations: [...standardProject, ".gemini/skills"],
    globalLocations: [...standardGlobal, "~/.gemini/skills"],
  },
  universal: {
    name: "universal",
    projectLocations: [
      ...standardProject,
      ".github/skills",
      ".claude/skills",
      ".codex/skills",
      ".cursor/skills",
      ".gemini/skills",
    ],
    globalLocations: [
      ...standardGlobal,
      "~/.claude/skills",
      "~/.codex/skills",
      "~/.cursor/skills",
      "~/.gemini/skills",
    ],
  },
};

export const skillProfiles: Readonly<Record<SkillProfileName, SkillProfile>> =
  Object.freeze(profiles);

export function getSkillProfile(
  profile: SkillProfileName | SkillProfile = "universal",
): SkillProfile {
  if (typeof profile === "string") {
    const selected = (
      skillProfiles as Readonly<Record<string, SkillProfile | undefined>>
    )[profile];
    if (selected === undefined)
      throw new TypeError(`Unknown skill profile: ${profile}`);
    return selected;
  }
  validateSkillProfile(profile);
  return profile;
}

function validateSkillProfile(profile: SkillProfile): void {
  if (profile.name.trim() === "") {
    throw new TypeError("Skill profile name cannot be empty");
  }
  for (const path of [
    ...profile.projectLocations,
    ...(profile.globalLocations ?? []),
  ]) {
    if (path.trim() === "" || path.includes("\0")) {
      throw new TypeError(`Skill location is invalid: ${path}`);
    }
  }
}
