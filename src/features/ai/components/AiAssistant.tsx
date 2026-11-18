import AiAssistantView from 'sang-ai-kit/assistant';
import type { GalleryImageClassifier } from 'sang-ai-kit';
import type { Language } from '../../../translations.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import { useAiAssistant } from '../hooks/useAiAssistant.ts';
import { useChatStore } from '../hooks/useChatStore.ts';
import { useFloatingPanel } from 'sang-ai-kit/floating';
import { DEFAULT_QUICK_SNIPPETS, resolveSelection, selectModel, updateActiveModel } from '../services/config.ts';
import { createImageUpload } from 'sang-ai-kit/image-attachments';
import { sumUsage } from '../services/usage.ts';
import { imageModelForTool } from './imageToolModel.ts';
import AiSettings from './AiSettings.tsx';
import MarkdownView from './MarkdownView.tsx';
import ModelControls from 'sang-ai-kit/model-controls';
import TokenUsageBar from './TokenUsageBar.tsx';
import { AI_FEATURES } from '../featureConfig.ts';

interface Props {
  workspace: WorkspaceOptions;
  lang: Language;
  onBusyChange: (busy: boolean) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const toolLabels: Record<string, [string, string]> = {
  skill: ['读取 SKILL', 'Read Skill'],
  list_fonts: ['读取可用字体', 'List Available Fonts'],
  get_context: ['读取画布', 'Read Canvas'],
  get_cover_size_recommendations: ['封面尺寸建议', 'Cover Size Recommendations'],
  create_project: ['新建项目', 'Create Project'],
  search_projects: ['搜索项目', 'Search Projects'],
  search_assets: ['搜索素材', 'Search Assets'],
  place_asset: ['放置素材', 'Place Asset'],
  manage_projects: ['项目管理', 'Manage Projects'],
  manage_pages: ['页面管理', 'Manage Pages'],
  read_layers: ['读取图层', 'Read Layers'],
  get_selected_layers: ['读取选中图层', 'Read Selected Layers'],
  add_layers: ['添加图层', 'Add Layers'],
  update_layers: ['更新图层', 'Update Layers'],
  delete_layers: ['删除图层', 'Delete Layers'],
  duplicate_layers: ['复制图层', 'Duplicate Layers'],
  group_layers: ['编组图层', 'Group Layers'],
  ungroup_layers: ['拆开编组', 'Ungroup Layers'],
  reorder_layers: ['排列图层', 'Reorder Layers'],
  align_layers: ['对齐图层', 'Align Layers'],
  distribute_layers: ['分布图层', 'Distribute Layers'],
  update_page: ['更新页面', 'Update Page'],
  list_image_models: ['读取生图模型', 'List Image Models'],
  generate_image: ['生成图片', 'Generate Image'],
  remove_background: ['移除背景', 'Remove Background'],
  get_canvas_preview: ['预览当前效果', 'Preview Canvas']
};

const classifyGalleryImage: GalleryImageClassifier = (image, tools) => {
  if (image.name.startsWith('generated-') || tools.some(tool => tool.name === 'generate_image' && tool.image?.id === image.id)) return 'generated';
  if (image.name.includes('preview') || image.name.startsWith('layer-') || tools.some(tool =>
    (tool.name === 'get_canvas_preview' || tool.name === 'get_selected_layers') && tool.image?.id === image.id
  )) return 'preview';
  return undefined;
};

export default function AiAssistant({ workspace, lang, onBusyChange, open, onOpenChange }: Props) {
  const chatStore = useChatStore(workspace);
  const assistant = useAiAssistant(workspace, onBusyChange, chatStore);
  const floating = useFloatingPanel(chatStore);
  const english = lang === 'en';
  const project = workspace.project;

  return <AiAssistantView
    assistant={assistant}
    floating={floating}
    language={lang}
    open={open}
    onOpenChange={onOpenChange}
    title={english ? 'CoverFlow AI' : 'AI 封面助手'}
    emptyTitle={english ? 'CoverFlow AI Assistant' : '封面设计智能助手'}
    emptyDescription={english ? 'Describe your creative ideas in plain text. I can adjust background colors, organize layers, and add headlines automatically.' : '通过自然语言描述，我可以直接为你调整画布背景、排版标题、增删装饰与组织图层。'}
    contextTitle={project?.title || (english ? 'Project Library' : '未打开项目 (项目库)')}
    contextMeta={project ? `${project.layers.length} ${english ? 'layers' : '图层'}` : ''}
    imageInsertAction={{
      enabled: Boolean(project),
      label: english ? 'Insert into current canvas' : '插入到当前画布',
      successLabel: english ? 'Inserted into current canvas' : '已插入到当前画布',
      disabledReason: english ? 'Open a project canvas first' : '请先打开一个项目画布'
    }}
    classifyGalleryImage={classifyGalleryImage}
    quickSnippets={assistant.config.quickSnippets || DEFAULT_QUICK_SNIPPETS}
    features={AI_FEATURES}
    active={resolveSelection(assistant.config)}
    imageToolsEnabled={AI_FEATURES.imageGeneration && assistant.config.imageModels?.some(model => model.enabled)}
    toolLabels={toolLabels}
    loadImage={(sessionId, imageId, type?: string) => chatStore.loadImage(sessionId, imageId, type)}
    createImageUpload={createImageUpload}
    imageModelForTool={tool => imageModelForTool(tool, assistant.config.imageModels)}
    sumUsage={sumUsage}
    renderMarkdown={content => <MarkdownView content={content} />}
    renderUsage={(prompt, useEnglish) => <TokenUsageBar session={assistant.sessions.find(session => session.id === assistant.activeSessionId)} config={assistant.config} prompt={prompt} busy={assistant.busy} english={useEnglish} />}
    renderModelControls={(disabled, useEnglish) => <ModelControls config={assistant.config} configure={assistant.configure} resolveSelection={resolveSelection} selectModel={selectModel} updateActiveModel={updateActiveModel} disabled={disabled} english={useEnglish} />}
    renderSettings={(close, initialSecurity) => <AiSettings key={chatStore.id} config={assistant.config} onSave={assistant.configure} onBack={close} english={english} store={chatStore} onKeyChanged={assistant.reloadConfig} initialSecurity={initialSecurity} />}
  />;
}