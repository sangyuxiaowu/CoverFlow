import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Save, Sparkles, Trash2 } from 'lucide-react';
import { PRESET_DECORATIONS } from '../constants.ts';
import { DecorationElement, DecorationTemplate, Layer, ProjectState } from '../types.ts';
import { translations, Language } from '../translations.ts';
import {
  getStoredDecorationElements,
  getStoredDecorationPresets,
  LocalFileAdapter,
  readDecorationLibraryFiles,
  setStoredDecorationElements,
  setStoredDecorationPresets,
  StorageAdapterType,
  writeDecorationElementsFile,
  writeDecorationPresetsFile
} from '../storage/storage.ts';
import {
  buildDecorationLayerStyle,
  clampDecorationSize,
  hasBlockingDecorationIssues,
  sanitizeDecorationCss
} from '../utils/decorationStyles.ts';
import { applySvgAspectRatio, generateId } from '../utils/helpers.ts';
import DecorationEditorModal from './DecorationEditorModal.tsx';

interface DecorationLibraryProps {
  lang: Language;
  storageType: StorageAdapterType;
  localFileAdapter: LocalFileAdapter;
  createRequestToken: number;
  project: ProjectState;
  selectedLayerIds: string[];
  onAddLayer: (layer: Partial<Layer>) => void;
  onApplyTemplate: (template: DecorationTemplate) => void;
}

type DraftDecoration = {
  name: string;
  width: number;
  height: number;
  cssText: string;
};

const DEFAULT_COLOR = '#38bdf8';

const createDraft = (element?: Partial<DecorationElement>): DraftDecoration => {
  const fallback = PRESET_DECORATIONS[0];
  return {
    name: element?.name || fallback.name,
    width: clampDecorationSize(element?.width ?? fallback.width, fallback.width),
    height: clampDecorationSize(element?.height ?? fallback.height, fallback.height),
    cssText: element?.cssText || fallback.cssText
  };
};

const cloneLayerForTemplate = (layer: Layer, offsetX: number, offsetY: number): Layer => ({
  ...JSON.parse(JSON.stringify(layer)),
  id: generateId(),
  x: layer.x - offsetX,
  y: layer.y - offsetY,
  zIndex: 0,
  visible: true,
  locked: false,
  parentId: undefined,
  children: undefined
});

const getTemplatePreviewTextStyle = (layer: Layer): React.CSSProperties => {
  const align = layer.textAlign || 'center';
  const textStyle: React.CSSProperties = {
    fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`,
    fontFamily: layer.fontFamily || 'Inter, sans-serif',
    fontWeight: layer.fontWeight || 'bold',
    wordBreak: 'break-word',
    opacity: layer.opacity,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    textAlign: align,
    lineHeight: 1.1,
    pointerEvents: 'none',
    padding: '0 0.5rem'
  };

  if (layer.type === 'text' && layer.writingMode === 'vertical') {
    textStyle.writingMode = 'vertical-rl';
    textStyle.textOrientation = 'upright';
    textStyle.padding = '0.5rem 0';
  }

  if (layer.type === 'text' && layer.textGradient?.enabled) {
    textStyle.backgroundImage = `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`;
    textStyle.WebkitBackgroundClip = 'text';
    textStyle.WebkitTextFillColor = 'transparent';
    textStyle.color = 'transparent';
  } else {
    textStyle.color = layer.color || '#ffffff';
  }

  if (layer.type === 'text' && layer.textShadow?.enabled) {
    textStyle.textShadow = `${layer.textShadow.offsetX}px ${layer.textShadow.offsetY}px ${layer.textShadow.blur}px ${layer.textShadow.color}`;
  }

  return textStyle;
};

const DecorationLibrary: React.FC<DecorationLibraryProps> = ({
  lang,
  storageType,
  localFileAdapter,
  createRequestToken,
  project,
  selectedLayerIds,
  onAddLayer,
  onApplyTemplate
}) => {
  const t = translations[lang];
  const [customElements, setCustomElements] = useState<DecorationElement[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<DecorationTemplate[]>([]);
  const [draft, setDraft] = useState<DraftDecoration>(() => createDraft());
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [storageError, setStorageError] = useState('');

  const draftResult = useMemo(() => sanitizeDecorationCss(draft.cssText), [draft.cssText]);

  const issueMessages = useMemo(() => {
    const messages = new Set<string>();
    draftResult.issues.forEach((issue) => {
      if (issue.code === 'empty') messages.add(t.decorationIssueEmpty);
      else if (issue.code === 'tooLong') messages.add(t.decorationIssueTooLong);
      else if (issue.code === 'invalidSyntax') messages.add(t.decorationIssueInvalidSyntax);
      else if (issue.code === 'unsupportedProperty') messages.add(t.decorationIssueUnsupportedProperty.replace('{detail}', issue.detail || ''));
      else if (issue.code === 'unsafeValue') messages.add(t.decorationIssueUnsafeValue.replace('{detail}', issue.detail || ''));
      else if (issue.code === 'noDeclarations') messages.add(t.decorationIssueNoDeclarations);
    });
    return Array.from(messages);
  }, [draftResult.issues, t]);

  const loadStoredData = useCallback(async () => {
    setStorageError('');
    try {
      if (storageType === 'localfile') {
        const ready = await localFileAdapter.ensureReady({ prompt: false });
        if (!ready) {
          setCustomElements([]);
          setSavedTemplates([]);
          return;
        }
        const rootHandle = localFileAdapter.getRootHandle();
        if (!rootHandle) {
          setCustomElements([]);
          setSavedTemplates([]);
          return;
        }
        const stored = await readDecorationLibraryFiles(rootHandle);
        setCustomElements(stored.elements);
        setSavedTemplates(stored.presets);
        return;
      }

      setCustomElements(getStoredDecorationElements());
      setSavedTemplates(getStoredDecorationPresets());
    } catch (_err) {
      setStorageError(t.decorationLoadFailed);
    }
  }, [localFileAdapter, storageType, t.decorationLoadFailed]);

  useEffect(() => {
    loadStoredData();
  }, [loadStoredData]);

  const persistCollections = useCallback(async (
    nextElements: DecorationElement[],
    nextTemplates: DecorationTemplate[]
  ) => {
    setStorageError('');
    try {
      if (storageType === 'localfile') {
        const ready = await localFileAdapter.ensureReady({ prompt: true });
        if (!ready) {
          setStorageError(t.decorationStorageFailed);
          return false;
        }
        const rootHandle = localFileAdapter.getRootHandle();
        if (!rootHandle) {
          setStorageError(t.decorationStorageFailed);
          return false;
        }
        await Promise.all([
          writeDecorationElementsFile(rootHandle, nextElements),
          writeDecorationPresetsFile(rootHandle, nextTemplates)
        ]);
      } else {
        setStoredDecorationElements(nextElements);
        setStoredDecorationPresets(nextTemplates);
      }

      setCustomElements(nextElements);
      setSavedTemplates(nextTemplates);
      return true;
    } catch (_err) {
      setStorageError(t.decorationStorageFailed);
      return false;
    }
  }, [localFileAdapter, storageType, t.decorationStorageFailed]);

  const openCreateModal = useCallback(() => {
    setDraft(createDraft());
    setEditingElementId(null);
    setIsEditorOpen(true);
  }, []);

  const openEditModal = useCallback((element: DecorationElement) => {
    setDraft(createDraft(element));
    setEditingElementId(element.id);
    setIsEditorOpen(true);
  }, []);

  useEffect(() => {
    if (createRequestToken > 0) {
      openCreateModal();
    }
  }, [createRequestToken, openCreateModal]);

  const buildElementFromDraft = useCallback(() => {
    return {
      name: draft.name.trim() || t.decorations,
      width: clampDecorationSize(draft.width, PRESET_DECORATIONS[0].width),
      height: clampDecorationSize(draft.height, PRESET_DECORATIONS[0].height),
      cssText: draftResult.cssText
    };
  }, [draft.height, draft.name, draft.width, draftResult.cssText, t.decorations]);

  const handleApplyElement = useCallback((element?: DecorationElement) => {
    const source = element || buildElementFromDraft();
    const result = sanitizeDecorationCss(source.cssText);
    if (hasBlockingDecorationIssues(result.issues)) {
      return;
    }

    onAddLayer({
      name: source.name,
      type: 'decoration',
      content: result.cssText,
      width: source.width,
      height: source.height,
      color: DEFAULT_COLOR
    });
    if (!element) setIsEditorOpen(false);
  }, [buildElementFromDraft, onAddLayer]);

  const handleSaveElement = useCallback(async () => {
    if (hasBlockingDecorationIssues(draftResult.issues)) return;
    const nextBase = buildElementFromDraft();
    const existing = editingElementId ? customElements.find((item) => item.id === editingElementId) : undefined;
    const nextElement: DecorationElement = {
      id: existing?.id || generateId(),
      name: nextBase.name,
      width: nextBase.width,
      height: nextBase.height,
      cssText: nextBase.cssText,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    const nextElements = existing
      ? customElements.map((item) => item.id === existing.id ? nextElement : item)
      : [nextElement, ...customElements];

    const saved = await persistCollections(nextElements, savedTemplates);
    if (saved) {
      setEditingElementId(nextElement.id);
      setIsEditorOpen(false);
    }
  }, [buildElementFromDraft, customElements, draftResult.issues, editingElementId, persistCollections, savedTemplates]);

  const handleDeleteElement = useCallback(async (id: string) => {
    const nextElements = customElements.filter((item) => item.id !== id);
    await persistCollections(nextElements, savedTemplates);
  }, [customElements, persistCollections, savedTemplates]);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    const nextTemplates = savedTemplates.filter((item) => item.id !== id);
    await persistCollections(customElements, nextTemplates);
  }, [customElements, persistCollections, savedTemplates]);

  const templateSourceLayers = useMemo(() => {
    const layerMap = new Map(project.layers.map((layer) => [layer.id, layer]));
    const sourceIds = selectedLayerIds.length > 0
      ? selectedLayerIds
      : project.layers.filter((layer) => layer.visible).map((layer) => layer.id);

    const expanded = new Set<string>();
    sourceIds.forEach((id) => {
      const layer = layerMap.get(id);
      if (!layer) return;
      if (layer.type === 'group') {
        (layer.children || []).forEach((childId) => expanded.add(childId));
      } else {
        expanded.add(id);
      }
    });

    return project.layers
      .filter((layer) => expanded.has(layer.id))
      .filter((layer) => layer.type !== 'group' && layer.type !== 'image')
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [project.layers, selectedLayerIds]);

  const handleSaveCurrentCanvasAsTemplate = useCallback(async () => {
    if (templateSourceLayers.length === 0) {
      return;
    }

    const minX = Math.min(...templateSourceLayers.map((layer) => layer.x));
    const minY = Math.min(...templateSourceLayers.map((layer) => layer.y));
    const maxX = Math.max(...templateSourceLayers.map((layer) => layer.x + layer.width));
    const maxY = Math.max(...templateSourceLayers.map((layer) => layer.y + layer.height));
    const nextTemplate: DecorationTemplate = {
      id: generateId(),
      name: `${project.title} ${lang === 'zh' ? '模板' : 'Template'}`,
      width: Math.max(1, Math.round(maxX - minX)),
      height: Math.max(1, Math.round(maxY - minY)),
      layers: templateSourceLayers.map((layer, index) => ({
        ...cloneLayerForTemplate(layer, minX, minY),
        zIndex: index + 1
      })),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await persistCollections(customElements, [nextTemplate, ...savedTemplates]);
  }, [customElements, lang, persistCollections, project.title, savedTemplates, templateSourceLayers]);

  const renderElementPreview = (element: DecorationElement) => {
    const scale = Math.min(1, 72 / Math.max(element.width, element.height, 1));
    return (
      <div className="h-20 flex items-center justify-center overflow-hidden">
        <div style={{ width: element.width, height: element.height, transform: `scale(${scale})`, transformOrigin: 'center center' }}>
          <div className="w-full h-full" style={buildDecorationLayerStyle(element.cssText, DEFAULT_COLOR)} />
        </div>
      </div>
    );
  };

  const renderTemplatePreview = (template: DecorationTemplate) => {
    const scale = Math.min(1, 78 / Math.max(template.width, template.height, 1));
    return (
      <div className="h-20 flex items-center justify-center overflow-hidden">
        <div className="relative overflow-hidden" style={{ width: template.width, height: template.height, transform: `scale(${scale})`, transformOrigin: 'center center' }}>
          {template.layers.map((layer) => {
            const textStyle = layer.type === 'text' ? getTemplatePreviewTextStyle(layer) : undefined;
            return (
              <div key={layer.id} className="absolute pointer-events-none" style={{ left: layer.x, top: layer.y, width: layer.width, height: layer.height, transform: `rotate(${layer.rotation}deg)`, zIndex: layer.zIndex }}>
                {layer.type === 'svg' ? (
                  <div className="w-full h-full overflow-hidden" style={{ color: layer.color, opacity: layer.opacity }}>
                    {layer.content.toLowerCase().includes('<svg') ? (
                      <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: applySvgAspectRatio(layer.content, !!layer.ratioLocked) }} />
                    ) : (
                      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio={layer.ratioLocked ? 'xMidYMid meet' : 'none'} dangerouslySetInnerHTML={{ __html: layer.content }} />
                    )}
                  </div>
                ) : layer.type === 'text' ? (
                  <div className="w-full h-full" style={textStyle}>{layer.content}</div>
                ) : layer.type === 'decoration' ? (
                  <div className="w-full h-full" style={{ ...buildDecorationLayerStyle(layer.content, layer.color || DEFAULT_COLOR), opacity: layer.opacity }} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderElementCard = (element: DecorationElement, options?: { editable?: boolean; removable?: boolean }) => {
    const label = lang === 'zh' ? element.nameZh || element.name : element.name;
    return (
      <div key={element.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 space-y-2">
        <button
          type="button"
          onClick={() => handleApplyElement(element)}
          className="w-full space-y-2 text-left hover:text-white transition-colors"
          title={t.decorationAddToCanvas}
        >
          {renderElementPreview(element)}
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-200 truncate">{label}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500">{element.width} x {element.height}</div>
          </div>
        </button>
        {(options?.editable || options?.removable) && (
          <div className="grid grid-cols-2 gap-1.5">
            {options.editable && (
              <button type="button" onClick={() => openEditModal(element)} className="flex items-center justify-center gap-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors px-2 py-1.5" title={t.decorationEdit}>
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {options.removable && (
              <button type="button" onClick={() => handleDeleteElement(element.id)} className="flex items-center justify-center gap-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-red-500 transition-colors px-2 py-1.5" title={t.decorationDelete}>
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTemplateCard = (template: DecorationTemplate) => {
    return (
      <div key={template.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 space-y-2">
        <button
          type="button"
          onClick={() => {
            onApplyTemplate(template);
          }}
          className="w-full space-y-2 text-left hover:text-white transition-colors"
          title={t.decorationTemplateApply}
        >
          {renderTemplatePreview(template)}
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-200 truncate">{template.name}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500">{template.layers.length} {t.layers} · {template.width} x {template.height}</div>
          </div>
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex items-center justify-center gap-1 rounded-lg bg-blue-600/10 text-blue-400 px-2 py-1.5 text-[10px] font-bold">
            <Sparkles className="w-3 h-3" />
            {t.apply}
          </div>
          <button type="button" onClick={() => handleDeleteTemplate(template.id)} className="flex items-center justify-center gap-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-red-500 transition-colors px-2 py-1.5" title={t.decorationDelete}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <DecorationEditorModal
        lang={lang}
        isOpen={isEditorOpen}
        mode={editingElementId ? 'edit' : 'create'}
        name={draft.name}
        width={draft.width}
        height={draft.height}
        cssText={draft.cssText}
        previewCssText={draftResult.cssText || draft.cssText}
        issueMessages={issueMessages}
        disabled={hasBlockingDecorationIssues(draftResult.issues)}
        onChangeName={(value) => setDraft((prev) => ({ ...prev, name: value }))}
        onChangeWidth={(value) => setDraft((prev) => ({ ...prev, width: clampDecorationSize(value, prev.width) }))}
        onChangeHeight={(value) => setDraft((prev) => ({ ...prev, height: clampDecorationSize(value, prev.height) }))}
        onChangeCssText={(value) => setDraft((prev) => ({ ...prev, cssText: value }))}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveElement}
        onApply={() => handleApplyElement()}
      />

      {storageError && (
        <div className="px-5 pt-4 space-y-1.5 min-h-[24px]">
          {storageError && <div className="text-[10px] text-red-400 leading-relaxed">{storageError}</div>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-5">
        <section className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.decorationBuiltin}</div>
          <div className="grid grid-cols-2 gap-3">
            {PRESET_DECORATIONS.map((element) => renderElementCard(element))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.decorationCustom}</div>
          {customElements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-[10px] text-slate-600 font-bold uppercase tracking-wider">{t.decorationEmptyCustom}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {customElements.map((element) => renderElementCard(element, { editable: true, removable: true }))}
            </div>
          )}
        </section>

        <section className="space-y-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.decorationTemplates}</div>
            <button
              type="button"
              onClick={handleSaveCurrentCanvasAsTemplate}
              className="p-1 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-md transition-all active:scale-95 flex items-center gap-1"
              title={t.decorationSaveCanvasTemplate}
            >
              <Save className="w-3.5 h-3.5" />
              <span className="text-[9px] font-bold">{t.decorationSaveCanvasTemplate}</span>
            </button>
          </div>
          {savedTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-[10px] text-slate-600 font-bold uppercase tracking-wider">{t.decorationEmptyPresets}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {savedTemplates.map(renderTemplateCard)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default DecorationLibrary;