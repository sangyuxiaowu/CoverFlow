import { describe, expect, it } from 'vitest';
import { exampleSkill, MAX_SKILLS, normalizeSkills, readSkill, skillsPrompt } from './skills.ts';

describe('plain-text skills', () => {
  it('defaults to empty and injects only escaped metadata', () => {
    expect(normalizeSkills(undefined)).toEqual([]);
    expect(skillsPrompt([])).toBe('');
    const skills = normalizeSkills([{ name: ' brand-cover ', description: '  Use for <brand> & logo  ', content: 'PRIVATE FULL CONTENT' }]);
    expect(skills[0].name).toBe('brand-cover');
    const prompt = skillsPrompt(skills);
    expect(prompt).toContain('name="brand-cover"');
    expect(prompt).toContain('Use for &lt;brand&gt; &amp; logo');
    expect(prompt).toContain('先调用 skill 工具');
    expect(prompt).not.toContain('PRIVATE FULL CONTENT');
  });

  it('rejects invalid, duplicate, incomplete and oversized skills', () => {
    const example = exampleSkill();
    for (const value of [null, {}, [null], [{ ...example, name: 'Brand Cover' }], [{ ...example, name: 'a--b' }], [{ ...example, name: 'a'.repeat(65) }], [example, { ...example, name: ' brand-cover ' }], [{ ...example, description: ' ' }], [{ ...example, description: 'a'.repeat(1001) }], [{ ...example, content: ' ' }], [{ ...example, content: 'a'.repeat(50001) }], Array.from({ length: MAX_SKILLS + 1 }, () => example)]) {
      expect(() => normalizeSkills(value)).toThrow();
    }
  });

  it('reads exact names only without changing the configured content', () => {
    const example = exampleSkill();
    const result = readSkill([example], { name: example.name });
    expect(result).toEqual(example);
    expect(result).not.toBe(example);
    for (const input of [{}, { name: 'Brand-Cover' }, { name: ' brand-cover' }, { name: example.name, path: 'file.txt' }]) {
      expect(() => readSkill([example], input)).toThrow();
    }
    expect(() => readSkill([], { name: example.name })).toThrow('not found');
    expect(normalizeSkills([exampleSkill()])).toHaveLength(1);
  });
});