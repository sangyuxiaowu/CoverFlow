import AiSettingsView from 'sang-ai-kit/settings';
import { createEndpoint, createModel } from 'sang-ai-kit';
import type { AiConfig } from '../types.ts';
import type { ChatStore } from '../services/chatStore.ts';
import { DEFAULT_IMAGE_TOOL_PROMPT, DEFAULT_MAX_IMAGE_FAILURES, DEFAULT_MAX_TOOL_ROUNDS, DEFAULT_QUICK_SNIPPETS, normalizeConfig, resolveSelection, SYSTEM_PROMPT } from '../services/config.ts';
import ImageModelSettings from 'sang-ai-kit/image-settings';
import SkillSettings from './SkillSettings.tsx';
import FontSettings from './FontSettings.tsx';
import EncryptionKeySettings from './EncryptionKeySettings.tsx';
import { AI_FEATURES } from '../featureConfig.ts';

interface Props {
  config: AiConfig;
  onSave: (config: AiConfig) => Promise<void>;
  onBack: () => void;
  english: boolean;
  store: ChatStore;
  onKeyChanged: () => Promise<void>;
  initialSecurity?: boolean;
}

export default function AiSettings(props: Props) {
  return <AiSettingsView {...props}
    features={AI_FEATURES}
    createEndpoint={createEndpoint}
    createModel={createModel}
    normalizeConfig={normalizeConfig}
    resolveSelection={resolveSelection}
    defaults={{ systemPrompt: SYSTEM_PROMPT, imageToolPrompt: DEFAULT_IMAGE_TOOL_PROMPT, quickSnippets: DEFAULT_QUICK_SNIPPETS, maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS, maxImageFailures: DEFAULT_MAX_IMAGE_FAILURES }}
    recommendedSnippets={['调整画布背景为高级暗色质感渐变', '为封面添加醒目的艺术大标题', '自动居中所有文字并优化上下间距', '在四周添加极简科技感几何边框与点缀', '将副标题调整为现代极简无衬线字体', '生成一张契合主题的高清插画背景图']}
    renderImageModels={(config, onChange, english) => <ImageModelSettings config={config} onChange={onChange} english={english} />}
    renderFonts={(fonts, onChange, english, enabled) => <FontSettings fonts={fonts} onChange={onChange} english={english} showLocalFonts={enabled.localFonts} showOnlineFonts={enabled.onlineFonts} />}
    renderSkills={(skills, onChange, english) => <SkillSettings skills={skills} onChange={onChange} english={english} />}
    renderEncryption={(manager, callbacks, english) => <EncryptionKeySettings manager={manager} english={english} {...callbacks} />}
  />;
}