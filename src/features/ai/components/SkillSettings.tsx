import React, { useState, useMemo, useId, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Plus,
  Trash2,
  Copy,
  Check,
  Search,
  Sparkles,
  FileText,
  AlertCircle,
  Download,
  Upload,
  Code2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  Wand2,
  FolderDown,
  SlidersHorizontal,
  ExternalLink
} from 'lucide-react';
import type { AiSkillConfig } from '../types.ts';
import { normalizeSkills } from '../services/skills.ts';
import ConfirmModal from '../../../components/ConfirmModal.tsx';

interface SkillSettingsProps {
  skills: AiSkillConfig[];
  onChange: (skills: AiSkillConfig[]) => void | Promise<void>;
  english: boolean;
}

// 预设的高质量技能模板
const PRESET_SKILLS: Array<{
  id: string;
  category: 'social' | 'tech' | 'minimal' | 'ecommerce' | 'brand';
  categoryLabelZh: string;
  categoryLabelEn: string;
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  contentZh: string;
  contentEn: string;
}> = [
  {
    id: 'social-media',
    category: 'social',
    categoryLabelZh: '社交媒体',
    categoryLabelEn: 'Social Media',
    name: 'xiaohongshu-cover',
    descriptionZh: '专为小红书/公众号设计的爆款视觉封面，强调高吸睛大字报与对比度',
    descriptionEn: 'High-contrast, eye-catching cover layout optimized for social media like Xiaohongshu',
    contentZh: `## 小红书爆款封面视觉规范
1. **排版原则**：
   - 主标题文字不低于 48px，采用加粗、鲜明对比色（如高饱和亮黄/亮白+暗底）。
   - 主副标题文字居中或偏上对齐，避开平台底部 UI 遮挡区域（保留至少 15% 底部安全边距）。
2. **色彩搭配**：
   - 整体视觉反差强烈，背景可使用深浅渐变或毛玻璃质感底色。
   - 点缀色限制在 1-2 种高明度色彩。
3. **视觉层次**：
   - 层次顺序：醒目标题 > 主体装饰/插画 > 副标引语 > 辅助标签点缀。
   - 善用科技或时尚感边框装饰提升精致度。`,
    contentEn: `## Social Media Cover Design Rules
1. **Typography**:
   - Primary heading >= 48px, bold, contrasting against background.
   - Position heading in upper 70% to avoid bottom platform UI obstruction.
2. **Color Palette**:
   - High contrast with vibrant accent colors.
3. **Visual Hierarchy**:
   - Catchy Title > Subject Image/Asset > Subtitle > Minimal decorative badges.`
  },
  {
    id: 'tech-minimal',
    category: 'tech',
    categoryLabelZh: '技术极客',
    categoryLabelEn: 'Tech & Geek',
    name: 'tech-minimalist',
    descriptionZh: '适合技术博客、GitHub开源项目、技术发布会的冷色极简工程风格',
    descriptionEn: 'Clean, dark-mode engineering aesthetic for tech blogs, GitHub repos, and dev tools',
    contentZh: `## 科技硬核极简封面规范
1. **背景基调**：
   - 采用深深蓝 (#0b0f19) 或炭灰黑 (#111827) 背景，可选微弱径向渐变。
   - 适当加入微透明科技点阵网格或柔和光晕 (Blur 60-100px)。
2. **字体与排版**：
   - 标题优先采用清晰的无衬线字体 (Inter / JetBrains Mono)。
   - 文字颜色使用纯白 (#f8fafc) 与科技蓝 (#60a5fa) 配合。
   - 字母间距微加宽 (Tracking +0.5px)，营造严谨现代工程质感。
3. **装饰元素**：
   - 添加终端风格点缀 (如 \`$ npx app\` 或状态红绿灯微圆点)。
   - 图层避免花哨，讲究对齐与留白。`,
    contentEn: `## Tech Minimalist Cover Rules
1. **Background**:
   - Deep slate/black (#0b0f19 or #111827) with subtle blue glow or dot grid.
2. **Typography**:
   - Clean sans-serif or monospace headings in bright white and sky blue.
   - Balanced line spacing with generous negative space.
3. **Accents**:
   - Terminal window header dots, subtle border highlights, code-styled tags.`
  },
  {
    id: 'brand-official',
    category: 'brand',
    categoryLabelZh: '品牌官方',
    categoryLabelEn: 'Brand Official',
    name: 'brand-guideline',
    descriptionZh: '企业官方对外宣传、产品发布封面，严格遵循规范化边距与严谨版式',
    descriptionEn: 'Formal enterprise and brand guidelines with strict padding, logo margins, and grid',
    contentZh: `## 品牌官方封面设计规范
1. **边界安全区**：
   - 四周保留不少于 40px 的安全内边距，不可有关键文字贴近边缘。
   - 品牌 Logo 置于左上角或右上角，高度控制在画布高度的 8%-12%。
2. **品牌基调**：
   - 保持企业品牌主色贯穿全局（作为主标题、关键线条或渐变亮点）。
   - 副标题字号为主标题的 35%-45%，行高适度拉开。
3. **稳重与品质**：
   - 严禁倾斜非艺术文字，严禁使用超出 3 种以上的字体颜色。
   - 画布整体呈现扁平现代或微质感质地。`,
    contentEn: `## Brand Guidelines
1. **Safe Margins**:
   - Minimum 40px margin on all sides. Logo placed in top corners (height 8-12%).
2. **Palette**:
   - Strictly adhere to official brand tones with high contrast.
3. **Layout**:
   - Balanced, structured, never exceeding 3 distinct font colors.`
  },
  {
    id: 'ecommerce-promo',
    category: 'ecommerce',
    categoryLabelZh: '电商促销',
    categoryLabelEn: 'E-Commerce',
    name: 'marketing-sale',
    descriptionZh: '活动大促、商品首图、折扣专题封面，重点突出利益点与紧迫感',
    descriptionEn: 'High-conversion marketing banner with prominent discounts and call-to-actions',
    contentZh: `## 营销大促高转化封面规范
1. **利益点第一**：
   - 核心折扣或促销数字（如 "50% OFF"、"限时立减"）需作为最大视觉焦点。
   - 价格与主标搭配双层描边或立体投影增加视觉分量。
2. **活力配色**：
   - 主色建议使用红色/橙色/金黄渐变，激活点击欲望。
3. **动感修饰**：
   - 适当倾斜角度 (±3°~5°) 营造冲击力，搭配标签化角标装饰。`,
    contentEn: `## Marketing Promotion Rules
1. **Value Focus**:
   - Prominent discount badge and urgent call to action.
2. **Colors**:
   - Warm energized hues (crimson, amber, gold accents).
3. **Visual Punch**:
   - Angular badges, high-impact contrasting text layers.`
  }
];

export default function SkillSettings({ skills = [], onChange, english }: SkillSettingsProps) {
  const formId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [formRequest, setFormRequest] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [copiedSkillName, setCopiedSkillName] = useState<string | null>(null);
  const [activePresetCategory, setActivePresetCategory] = useState<string>('all');
  const [jsonImportError, setJsonImportError] = useState<string | null>(null);
  const [jsonExportSuccess, setJsonExportSuccess] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // 临时编辑状态
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const savePending = useRef(false);

  const label = (zh: string, en: string) => (english ? en : zh);

  const persistSkills = async (nextSkills: AiSkillConfig[], onSuccess?: () => void) => {
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await onChange(normalizeSkills(nextSkills));
      onSuccess?.();
      setSaved(true);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : label('技能保存失败，请重试', 'Unable to save skills. Please retry.'));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  useLayoutEffect(() => {
    if (!formRequest) return;
    editorRef.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    nameRef.current?.focus({ preventScroll: true });
  }, [formRequest]);

  // 过滤后的技能列表
  const filteredSkills = useMemo(() => {
    if (!searchTerm.trim()) return skills;
    const term = searchTerm.toLowerCase();
    return skills.filter(
      s =>
        s.name.toLowerCase().includes(term) ||
        (s.description && s.description.toLowerCase().includes(term)) ||
        (s.content && s.content.toLowerCase().includes(term))
    );
  }, [skills, searchTerm]);

  // 开始新建技能
  const handleStartCreate = () => {
    setFormRequest(value => value + 1);
    setEditingIndex(null);
    setIsCreatingNew(true);
    setFormName('');
    setFormDesc('');
    setFormContent('');
    setFormError('');
  };

  // 开始编辑现有技能
  const handleStartEdit = (index: number) => {
    setFormRequest(value => value + 1);
    setIsCreatingNew(false);
    setEditingIndex(index);
    const target = skills[index];
    setFormName(target.name);
    setFormDesc(target.description || '');
    setFormContent(target.content || '');
    setFormError('');
  };

  // 取消编辑
  const handleCancelForm = () => {
    setIsCreatingNew(false);
    setEditingIndex(null);
    setFormName('');
    setFormDesc('');
    setFormContent('');
    setFormError('');
  };

  // 保存技能
  const handleSaveForm = () => {
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError(label('技能名称不能为空', 'Skill name cannot be empty'));
      return;
    }
    // 检查重名 (排除当前正在编辑的项)
    const isDuplicate = skills.some((s, idx) => {
      if (!isCreatingNew && idx === editingIndex) return false;
      return s.name.toLowerCase() === trimmedName.toLowerCase();
    });

    if (isDuplicate) {
      setFormError(label(`已存在名称为 "${trimmedName}" 的技能`, `Skill "${trimmedName}" already exists`));
      return;
    }

    const nextSkill: AiSkillConfig = {
      name: trimmedName,
      description: formDesc.trim(),
      content: formContent
    };

    const nextList = [...skills];
    if (isCreatingNew) {
      nextList.push(nextSkill);
    } else if (editingIndex !== null) {
      nextList[editingIndex] = nextSkill;
    }
    let normalized: AiSkillConfig[];
    try {
      normalized = normalizeSkills(nextList);
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }
    void persistSkills(normalized, handleCancelForm);
  };

  // 删除技能
  const handleDeleteSkill = (index: number) => {
    const nextList = skills.filter((_, i) => i !== index);
    void persistSkills(nextList, () => {
      if (editingIndex === index) {
        handleCancelForm();
      } else if (editingIndex !== null && editingIndex > index) {
        setEditingIndex(editingIndex - 1);
      }
    });
  };

  // 复制技能
  const handleDuplicateSkill = (skill: AiSkillConfig) => {
    let newName = `${skill.name}-copy`;
    let counter = 1;
    while (skills.some(s => s.name.toLowerCase() === newName.toLowerCase())) {
      counter++;
      newName = `${skill.name}-copy-${counter}`;
    }
    const cloned: AiSkillConfig = {
      name: newName,
      description: skill.description,
      content: skill.content
    };
    void persistSkills([...skills, cloned]);
  };

  // 应用官方预设
  const handleApplyPreset = (preset: typeof PRESET_SKILLS[0]) => {
    const name = preset.name;
    const exists = skills.some(s => s.name.toLowerCase() === name.toLowerCase());
    const finalName = exists ? `${name}-${Date.now().toString().slice(-4)}` : name;

    const newSkill: AiSkillConfig = {
      name: finalName,
      description: english ? preset.descriptionEn : preset.descriptionZh,
      content: english ? preset.contentEn : preset.contentZh
    };

    void persistSkills([...skills, newSkill]);
  };

  // 导出为 JSON
  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(skills, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `coverflow-skills-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setJsonExportSuccess(true);
    setTimeout(() => setJsonExportSuccess(false), 2000);
  };

  // 导入 JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJsonImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!Array.isArray(parsed)) {
          throw new Error(label('文件格式错误：必须为 SKILL 数组 JSON', 'Invalid JSON: Expected an array of skills'));
        }

        const validSkills: AiSkillConfig[] = [];
        const seen = new Set(skills.map(s => s.name.toLowerCase()));

        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof item.name === 'string') {
            const name = item.name.trim();
            if (!name) continue;
            let finalName = name;
            let counter = 1;
            while (seen.has(finalName.toLowerCase())) {
              counter++;
              finalName = `${name}-${counter}`;
            }
            seen.add(finalName.toLowerCase());

            validSkills.push({
              name: finalName,
              description: typeof item.description === 'string' ? item.description.trim() : '',
              content: typeof item.content === 'string' ? item.content : ''
            });
          }
        }

        if (validSkills.length === 0) {
          throw new Error(label('未在文件中找到有效的技能配置', 'No valid skill definitions found in JSON'));
        }

        await persistSkills(normalizeSkills([...skills, ...validSkills]));
      } catch (err) {
        setJsonImportError((err as Error).message || label('导入失败，请检查文件格式', 'Import failed'));
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // 复制技能内容
  const handleCopyContent = async (skill: AiSkillConfig) => {
    try {
      await navigator.clipboard.writeText(skill.content);
      setCopiedSkillName(skill.name);
      setTimeout(() => setCopiedSkillName(null), 1500);
    } catch {}
  };

  const toggleExpand = (name: string) => {
    setExpandedCards(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-6 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
      {saveError && <p role="alert" className="text-xs text-rose-300">{saveError}</p>}
      {saved && !saveError && <p role="status" className="text-xs text-emerald-300">{label('已保存', 'Saved')}</p>}
      {/* 顶部旗舰介绍与状态卡片 */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/30 via-slate-900/60 to-blue-950/20 p-5 backdrop-blur-sm shadow-lg shadow-indigo-950/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0 shadow-inner">
                <BookOpen size={17} />
              </div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <span>{label('AI 设计技能库 (SKILL System)', 'AI Design Skills Library')}</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {skills.length} {label('项规则已装载', 'loaded')}
                </span>
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
              {label(
                'SKILL 是一种按需调用的纯文本领域知识规范。平时仅向大模型注入索引名称与触发简述，零占用上下文；当任务匹配时，大模型主动调用 skill 工具读取详尽设计准则，确保排版和风格统一。',
                'Skills provide on-demand domain design knowledge. Only brief summaries are injected initially, keeping context light. When relevant, the assistant retrieves detailed guidelines to guarantee consistent style.'
              )}
            </p>
          </div>

          {/* 右侧动作按钮组 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 导出 JSON */}
            <button
              type="button"
              onClick={handleExportJson}
              disabled={skills.length === 0}
              className="px-3 py-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold text-slate-300 hover:text-white border border-slate-750 transition-colors flex items-center gap-1.5 cursor-pointer"
              title={label('导出全部技能为 JSON 文件', 'Export skills as JSON')}
            >
              {jsonExportSuccess ? <Check size={13} className="text-emerald-400" /> : <FolderDown size={13} />}
              <span>{jsonExportSuccess ? label('已导出', 'Exported') : label('导出', 'Export')}</span>
            </button>

            {/* 导入 JSON */}
            <label
              className="px-3 py-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white border border-slate-750 transition-colors flex items-center gap-1.5 cursor-pointer"
              title={label('从 JSON 文件导入技能', 'Import skills from JSON')}
            >
              <Upload size={13} />
              <span>{label('导入', 'Import')}</span>
              <input type="file" accept=".json,application/json" onChange={handleImportJson} className="hidden" />
            </label>

            {/* 新建技能 */}
            <button
              type="button"
              onClick={handleStartCreate}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-indigo-900/30 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={14} />
              <span>{label('新建技能', 'New Skill')}</span>
            </button>
          </div>
        </div>

        {jsonImportError && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{jsonImportError}</span>
          </div>
        )}
      </div>

      {/* 技能编辑/新建抽屉面板 */}
      {(isCreatingNew || editingIndex !== null) && (
        <div ref={editorRef} className="p-5 rounded-2xl border border-indigo-500/40 bg-slate-900/90 shadow-xl shadow-indigo-950/20 space-y-4 animate-in fade-in-50 zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Code2 size={16} />
              </span>
              <h4 className="text-sm font-bold text-white">
                {isCreatingNew
                  ? label('创建全新设计技能 (New SKILL)', 'Create New Design SKILL')
                  : label(`编辑技能: ${skills[editingIndex!]?.name}`, `Edit Skill: ${skills[editingIndex!]?.name}`)}
              </h4>
            </div>
            <button
              type="button"
              onClick={handleCancelForm}
              className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {label('取消', 'Cancel')}
            </button>
          </div>

          {formError && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0 text-rose-400" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${formId}-name`} className="text-[11px] font-semibold text-slate-300 block mb-1">
                {label('技能唯一标识 (Skill Name / ID)', 'Skill Name (Slug ID)')} <span className="text-rose-400">*</span>
              </label>
              <input
                id={`${formId}-name`}
                ref={nameRef}
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                placeholder={label('例如：brand-guideline 或 tech-blog', 'e.g. brand-guideline or tech-blog')}
                className="w-full bg-slate-950/90 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 outline-none transition-all"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                {label('推荐使用小写字母、数字和连字符 (kebab-case)，例如 "editorial-cover"', 'Use lowercase letters, numbers and hyphens')}
              </span>
            </div>

            <div>
              <label htmlFor={`${formId}-description`} className="text-[11px] font-semibold text-slate-300 block mb-1">
                {label('触发场景与使用建议 (Description)', 'Trigger Context / Description')}
              </label>
              <input
                id={`${formId}-description`}
                type="text"
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder={label('例如：专用于科技博客与技术分享类封面，规范深色网格与终端排版', 'e.g. Use when creating minimalist tech blog covers with code snippets')}
                className="w-full bg-slate-950/90 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-all"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                {label('在大模型系统提示词中常驻展示，用于指引大模型何时主动触发读取此规则', 'Injected into system prompt so the model knows when to invoke this skill')}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`${formId}-content`} className="text-[11px] font-semibold text-slate-300">
                {label('完整设计规则内容 (Markdown / Plain Text)', 'Full Skill Content (Markdown)')}
              </label>
              <span className="text-[10px] font-mono text-slate-500">
                {formContent.length} {label('字符', 'chars')} · ~{Math.ceil(formContent.length / 4)} tokens
              </span>
            </div>
            <textarea
              id={`${formId}-content`}
              rows={8}
              value={formContent}
              onChange={e => setFormContent(e.target.value)}
              placeholder={label(
                '## 视觉准则\n1. 配色要求：主色采用深色调 (#0b0f19)，高光蓝 (#38bdf8)\n2. 字体规则：标题不低于 42px，文字避开底部安全区\n3. 装饰元素：添加终端风格点缀...',
                '## Guidelines\n1. Palette: Deep slate background with electric cyan accents\n2. Typography: Main heading >= 42px\n3. Layout: Clean margins and centered subject...'
              )}
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl p-3 text-xs font-mono text-slate-200 leading-relaxed outline-none transition-all custom-scrollbar"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleCancelForm}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
            >
              {label('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveForm}
              disabled={saving}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-900/30 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Check size={14} />
              <span>{saving ? label('保存中...', 'Saving...') : isCreatingNew ? label('确认添加技能', 'Add Skill') : label('保存修改', 'Save Changes')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 搜索与分类快速筛选栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={label('搜索技能名称、描述或内容关键词...', 'Search skills by name, description or content...')}
            className="w-full bg-slate-900/80 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder:text-slate-500 outline-none transition-all shadow-inner"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
            >
              ✕
            </button>
          )}
        </div>

        <div className="text-xs text-slate-400 font-medium">
          {label(`共 ${skills.length} 个技能`, `Total ${skills.length} skills`)}
          {searchTerm && ` (${label(`匹配 ${filteredSkills.length} 个`, `${filteredSkills.length} matched`)})`}
        </div>
      </div>

      {/* 技能列表卡片区域 */}
      <div className="space-y-3">
        {filteredSkills.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <BookOpen size={22} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-200">
                {searchTerm
                  ? label('未找到匹配的技能', 'No matching skills found')
                  : label('暂无已配置的 SKILL 规则', 'No design skills configured yet')}
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {searchTerm
                  ? label('请尝试使用其他搜索词，或点击清空重置。', 'Try different keywords or clear search input.')
                  : label('可以从下方的官方推荐预设中一键添加，或点击右上角“新建技能”开始自定义。', 'Click one of the recommended presets below to get started in 1-click.')}
              </p>
            </div>
            {!searchTerm && (
              <button
                type="button"
                onClick={handleStartCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-900/30 cursor-pointer"
              >
                <Plus size={14} />
                <span>{label('立即创建第一个技能', 'Create First Skill')}</span>
              </button>
            )}
          </div>
        ) : (
          filteredSkills.map((skill, index) => {
            const actualIndex = skills.indexOf(skill);
            const isExpanded = Boolean(expandedCards[skill.name]);
            const charCount = skill.content ? skill.content.length : 0;
            const approxTokens = Math.ceil(charCount / 4);

            return (
              <div
                key={skill.name}
                className="rounded-2xl border border-slate-800 hover:border-slate-700/80 bg-slate-900/60 overflow-hidden transition-all duration-200 group shadow-sm"
              >
                {/* 技能卡片头部 */}
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleExpand(skill.name)}
                      className="mt-0.5 p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 transition-colors shrink-0 cursor-pointer"
                      title={isExpanded ? label('收起规则详情', 'Collapse rules') : label('展开查看规则详情', 'Expand rules')}
                    >
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">
                          {skill.name}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {charCount} {label('字', 'chars')} · ~{approxTokens} tokens
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 font-medium line-clamp-2">
                        {skill.description || <span className="text-slate-500 italic">{label('未提供使用建议描述', 'No trigger description')}</span>}
                      </p>
                    </div>
                  </div>

                  {/* 右侧动作按钮栏 */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* 复制 Markdown */}
                    <button
                      type="button"
                      onClick={() => handleCopyContent(skill)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      title={label('复制 Markdown 内容', 'Copy Markdown content')}
                    >
                      {copiedSkillName === skill.name ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>

                    {/* 克隆/复制该技能 */}
                    <button
                      type="button"
                      onClick={() => handleDuplicateSkill(skill)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                      title={label('克隆并复制该技能', 'Clone skill')}
                    >
                      <Sparkles size={14} />
                    </button>

                    {/* 编辑技能 */}
                    <button
                      type="button"
                      onClick={() => handleStartEdit(actualIndex)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {label('编辑', 'Edit')}
                    </button>

                    {/* 删除技能 */}
                    <button
                      type="button"
                      onClick={() => setPendingDelete(skill.name)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title={label('删除此技能', 'Delete skill')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* 展开的规则预览区域 */}
                {isExpanded && (
                  <div className="border-t border-slate-800/80 bg-slate-950/60 p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <FileText size={13} className="text-indigo-400" />
                        <span>{label('规则内容预览', 'Rule Content Preview')}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyContent(skill)}
                        className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={12} />
                        <span>{label('复制全部', 'Copy all')}</span>
                      </button>
                    </div>

                    <pre className="text-xs font-mono text-slate-300 bg-slate-950/80 p-3 rounded-xl border border-slate-850/80 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60 custom-scrollbar select-text">
                      {skill.content || <span className="text-slate-600 italic">{label('暂无详细规则内容', 'Empty content')}</span>}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 官方精选推荐预设库 */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800">
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Wand2 size={15} className="text-indigo-400" />
              <span>{label('精选设计规范预设库 (点击一键加入)', 'Curated Design Presets (1-Click Add)')}</span>
            </h4>
            <p className="text-[11px] text-slate-500">
              {label('可直接采纳为专属设计规则，也可以在添加后按需修改定制。', 'Pre-crafted guidelines for popular visual styles.')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PRESET_SKILLS.map(preset => {
            const alreadyAdded = skills.some(s => s.name.toLowerCase() === preset.name.toLowerCase());

            return (
              <div
                key={preset.id}
                className="p-4 rounded-xl border border-slate-800 hover:border-indigo-500/40 bg-slate-900/60 hover:bg-slate-900/90 transition-all space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <Code2 size={13} className="text-indigo-400 shrink-0" />
                      <span>{preset.name}</span>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                      {english ? preset.categoryLabelEn : preset.categoryLabelZh}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {english ? preset.descriptionEn : preset.descriptionZh}
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-slate-800/60">
                  <span className="text-[10px] text-slate-500 font-mono">
                    ~{Math.ceil((english ? preset.contentEn : preset.contentZh).length / 4)} tokens
                  </span>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                      alreadyAdded
                        ? 'bg-slate-800 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/20'
                        : 'bg-indigo-600/20 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/30'
                    }`}
                  >
                    <Plus size={13} />
                    <span>{alreadyAdded ? label('再次添加副本', 'Add as copy') : label('加入我的技能', 'Add to My Skills')}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {pendingDelete !== null && createPortal(
        <ConfirmModal
          isOpen
          lang={english ? 'en' : 'zh'}
          message={label(`确定删除技能“${pendingDelete}”吗？`, `Delete skill "${pendingDelete}"?`)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const index = skills.findIndex(skill => skill.name === pendingDelete);
            if (index !== -1) handleDeleteSkill(index);
            setPendingDelete(null);
          }}
        />,
        document.body
      )}
    </fieldset>
  );
}
