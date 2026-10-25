import type { AiSkillConfig } from '../types.ts';

export const MAX_SKILLS = 50;
export const MAX_SKILL_CONTENT = 50000;

export function exampleSkill(): AiSkillConfig {
  return {
    name: 'brand-cover',
    description: 'Use for brand covers and official template designs',
    content: '## Brand Cover Guidelines\n1. Ensure high contrast and professional typography.\n2. Respect margins and canvas hierarchy.\n3. Keep visual balance across all layers.'
  };
}

export function normalizeSkills(value: unknown): AiSkillConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILLS) throw new Error('Skills must be a list of at most 50 entries.');
  const names = new Set<string>();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid skill.');
    const { name, description, content } = entry;
    if (typeof name !== 'string' || name.trim().length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.trim())) throw new Error('Skill name must use lowercase letters, digits and single hyphens (1-64 characters).');
    const normalizedName = name.trim();
    if (names.has(normalizedName)) throw new Error('Duplicate skill name: ' + normalizedName);
    names.add(normalizedName);
    if (typeof description !== 'string' || !description.trim() || description.length > 1000) throw new Error('Skill description must contain 1-1000 characters.');
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_SKILL_CONTENT) throw new Error('Skill content must contain 1-50000 characters.');
    return { name: normalizedName, description: description.trim(), content };
  });
}

export function skillsPrompt(skills: AiSkillConfig[] = []): string {
  if (!skills.length) return '';
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const summaries = skills.map(skill => `<skill name="${skill.name}"><description>${escape(skill.description)}</description></skill>`).join('\n');
  return `## Available Skills
当用户的设计任务或需求与以下任一技能匹配时，在继续操作前，请使用确切的技能名称调用\`skill\`工具，阅读其完整规则。
<available_skills>
${summaries}
</available_skills>`;
}

export function readSkill(skills: AiSkillConfig[], input: Record<string, unknown>): AiSkillConfig {
  if (Object.keys(input).some(field => field !== 'name')) throw new Error('skill only accepts name.');
  if (typeof input.name !== 'string') throw new Error('Skill name is required.');
  const skill = skills.find(entry => entry.name === input.name);
  if (!skill) throw new Error('Skill not found: ' + input.name);
  return { ...skill };
}
