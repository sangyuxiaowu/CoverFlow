import React, { useId, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import type { AiSkillConfig } from '../types.ts';
import { exampleSkill, MAX_SKILLS, MAX_SKILL_CONTENT } from '../services/skills.ts';

interface Props {
  skills: AiSkillConfig[];
  onChange: (skills: AiSkillConfig[]) => void;
  english: boolean;
}

export default function SkillSettings({ skills, onChange, english }: Props) {
  const id = useId();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, skills.length - 1));
  const selected = skills[activeIndex];
  const label = (zh: string, en: string) => english ? en : zh;
  const add = (example: boolean) => {
    if (skills.length >= MAX_SKILLS) return;
    const entry = example ? exampleSkill() : { name: 'new-skill', description: '', content: '' };
    const baseName = entry.name;
    let suffix = 2;
    while (skills.some(skill => skill.name === entry.name)) entry.name = `${baseName}-${suffix++}`;
    onChange([...skills, entry]);
    setSelectedIndex(skills.length);
  };
  const update = (patch: Partial<AiSkillConfig>) => {
    onChange(skills.map((skill, index) => index === activeIndex ? { ...skill, ...patch } : skill));
  };
  const inputClass = 'w-full min-w-0 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20';

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <BookOpen size={16} className="text-emerald-400" />
          SKILL <span className="text-xs font-normal text-slate-500">{skills.length}/{MAX_SKILLS}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => add(true)} disabled={skills.length >= MAX_SKILLS}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40">
            <BookOpen size={14} />{label('添加示例', 'Add Example')}
          </button>
          <button type="button" onClick={() => add(false)} disabled={skills.length >= MAX_SKILLS}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
            <Plus size={14} />{label('添加 SKILL', 'Add Skill')}
          </button>
        </div>
      </div>

      {!selected ? (
        <div className="py-12 text-center text-sm text-slate-500">{label('暂无 SKILL', 'No Skills')}</div>
      ) : (
        <>
          <div className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor={`${id}-select`} className="block text-xs font-semibold text-slate-400">SKILL</label>
              <select id={`${id}-select`} value={activeIndex} onChange={event => setSelectedIndex(Number(event.target.value))} className={inputClass}>
                {skills.map((skill, index) => <option key={index} value={index}>{skill.name || label('未命名', 'Untitled')}</option>)}
              </select>
            </div>
            <button type="button" title={label('删除当前 SKILL', 'Delete Current Skill')} aria-label={label('删除当前 SKILL', 'Delete Current Skill')}
              onClick={() => { onChange(skills.filter((_, index) => index !== activeIndex)); setSelectedIndex(Math.max(0, activeIndex - 1)); }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/10 hover:text-rose-400">
              <Trash2 size={16} />
            </button>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="block text-xs font-semibold text-slate-400">{label('名称', 'Name')}</label>
            <input id={`${id}-name`} value={selected.name} onChange={event => update({ name: event.target.value })}
              required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" title={label('小写字母、数字和单个连字符', 'Lowercase letters, digits and single hyphens')}
              autoComplete="off" spellCheck={false} className={`${inputClass} font-mono`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-description`} className="block text-xs font-semibold text-slate-400">{label('适用描述', 'Description')}</label>
            <textarea id={`${id}-description`} value={selected.description} onChange={event => update({ description: event.target.value })}
              required maxLength={1000} rows={3} className={`${inputClass} resize-y leading-relaxed`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-content`} className="block text-xs font-semibold text-slate-400">{label('内容', 'Content')}</label>
            <textarea id={`${id}-content`} value={selected.content} onChange={event => update({ content: event.target.value })}
              required maxLength={MAX_SKILL_CONTENT} rows={14} spellCheck={false} className={`${inputClass} resize-y font-mono leading-relaxed custom-scrollbar`} />
            <div className="text-right text-[11px] text-slate-500">{selected.content.length}/{MAX_SKILL_CONTENT}</div>
          </div>
        </>
      )}
    </section>
  );
}