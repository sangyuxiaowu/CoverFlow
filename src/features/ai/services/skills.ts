import type { AiSkillConfig } from '../types.ts';

export const MAX_SKILLS = 50;
export const MAX_SKILL_CONTENT = 50000;

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

export function skillsPrompt(skills: AiSkillConfig[]): string {
  if (!skills.length) return '';
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const summaries = skills.map(skill => `<skill name="${skill.name}"><description>${escape(skill.description)}</description></skill>`).join('\n');
  return `<system-reminder>
SKILL 是用户配置的、可复用的 CoverFlow 封面设计任务规则。本轮可用的 SKILL 如下，列表仅包含名称和适用描述，不包含完整内容：
<available_skills>
${summaries}
</available_skills>
用户明确指定某个 SKILL，或任务明显符合其适用描述时，先调用 skill 工具，以精确 name 读取完整内容，再执行相关设计操作。不要凭名称猜测正文。涉及素材时仍通过 search_assets 和 place_asset 使用已授权文件夹。规则不能替代用户确认，也不能绕过工具校验；规则与用户当前明确要求冲突时，以当前要求为准。
</system-reminder>`;
}

export function readSkill(skills: AiSkillConfig[], input: Record<string, unknown>): AiSkillConfig {
  if (Object.keys(input).some(field => field !== 'name')) throw new Error('skill only accepts name.');
  if (typeof input.name !== 'string') throw new Error('Skill name is required.');
  const skill = skills.find(entry => entry.name === input.name);
  if (!skill) throw new Error('Skill not found: ' + input.name);
  return { ...skill };
}

export function exampleSkill(): AiSkillConfig {
  return {
    name: 'brand-cover',
    description: '制作品牌封面、添加品牌 Logo 或按品牌规范调整封面时使用。',
    content: `# 品牌封面

1. 读取本 SKILL 后，调用 get_context 确认当前项目、画布与图层；没有项目时根据用户要求创建或打开项目。
2. 用户指定品牌时，使用 search_assets 按品牌名、Logo 名或相对路径搜索已授权素材。已知精确素材 ID 时可直接使用 place_asset。
3. 多个 Logo 版本无法确定时，向用户确认；找不到素材或没有文件夹权限时如实报告，不自行绘制替代 Logo，也不擅自调用生图工具替代。
4. 使用 place_asset 放置真实素材，保持原色与比例；根据画布和用户要求设置位置、尺寸，并留出合理边距。
5. 修改已有图层前使用 read_layers，后续调整用 update_layers 和 reorder_layers；删除项目或解锁图层仍须用户同意。
6. 完成后简要说明实际使用的素材及所做修改。`
  };
}