import SkillSettingsView from 'sang-ai-kit/skill-settings';
import ConfirmModal from '../../../components/ConfirmModal.tsx';
import type { AiSkillConfig } from '../types.ts';
import { COVERFLOW_SKILL_PRESETS } from './skillPresets.ts';

interface Props {
  skills: AiSkillConfig[];
  onChange: (skills: AiSkillConfig[]) => void | Promise<void>;
  english: boolean;
}

export default function SkillSettings({ skills, onChange, english }: Props) {
  return <SkillSettingsView skills={skills} onChange={onChange} english={english} presets={COVERFLOW_SKILL_PRESETS} exportPrefix="coverflow-skills"
    renderConfirm={(message, onCancel, onConfirm) => <ConfirmModal isOpen lang={english ? 'en' : 'zh'} message={message} onCancel={onCancel} onConfirm={onConfirm} />} />;
}