import type { AiSkillConfig } from '../types.ts';

export { MAX_SKILLS, MAX_SKILL_CONTENT, normalizeSkills, skillsPrompt, readSkill } from 'sang-ai-kit/skills';

export function exampleSkill(): AiSkillConfig {
  return {
    name: 'brand-cover',
    description: 'Use for brand covers and official template designs',
    content: '## Brand Cover Guidelines\n1. Ensure high contrast and professional typography.\n2. Respect margins and canvas hierarchy.\n3. Keep visual balance across all layers.'
  };
}