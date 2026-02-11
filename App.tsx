
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar.tsx';
import Canvas from './components/Canvas.tsx';
import LayersPanel from './components/LayersPanel.tsx';
import { ProjectState, Layer, BackgroundConfig } from './types.ts';
import { translations, Language } from './translations.ts';
import { PRESET_RATIOS } from './constants.ts';
import { generateId, downloadFile, normalizeSVG, getSVGDimensions } from './utils/helpers.ts';
import { 
  Download, Trash2, Plus, Share2, ArrowLeft, Clock, 
  Layout as LayoutIcon, ChevronRight, LayoutGrid, CheckCircle2, AlertCircle,
  Upload, Type as TextIcon, ImagePlus, FileOutput, Undo2, Redo2, Search, X
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';

const STORAGE_KEY = 'coverflow_projects_v2';

const Toast = ({ message, type }: { message: string, type: 'success' | 'error' }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300 ${
    type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
  }`}>
    {type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
    <span className="font-bold text-sm">{message}</span>
  </div>
);

const ConfirmModal = ({ isOpen, message, onConfirm, onCancel, lang }: { isOpen: boolean, message: string, onConfirm: () => void, onCancel: () => void, lang: Language }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-6 scale-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-amber-500"><AlertCircle className="w-6 h-6" /><h3 className="text-lg font-bold text-slate-100">{lang === 'zh' ? '提示' : 'Confirmation'}</h3></div>
        <p className="text-slate-300 text-sm leading-relaxed font-medium">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors">{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button onClick={onConfirm} className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95">{lang === 'zh' ? '确认删除' : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('coverflow_lang') as Language) || 'zh');
  const t = translations[lang];
  const [projects, setProjects] = useState<ProjectState[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [project, setProject] = useState<ProjectState | null>(null);
  const [activeTab, setActiveTab] = useState('assets');
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const isUndoRedoAction = useRef(false);
  const ignoreHistoryChange = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch (e) {}
  }, [projects]);

  useEffect(() => {
    if (project && view === 'editor') {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...project, updatedAt: Date.now() } : p));
    }
  }, [project, view]);

  useEffect(() => { localStorage.setItem('coverflow_lang', lang); }, [lang]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (project && !isUndoRedoAction.current && !ignoreHistoryChange.current) {
      const lastState = history[historyIndex];
      if (JSON.stringify(lastState) !== JSON.stringify(project)) {
         const newHistory = history.slice(0, historyIndex + 1);
         newHistory.push(JSON.parse(JSON.stringify(project)));
         if (newHistory.length > 50) newHistory.shift();
         setHistory(newHistory);
         setHistoryIndex(newHistory.length - 1);
      }
    }
    isUndoRedoAction.current = false;
    ignoreHistoryChange.current = false;
  }, [project]);

  const initProjectHistory = (p: ProjectState) => {
    setHistory([JSON.parse(JSON.stringify(p))]);
    setHistoryIndex(0);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      isUndoRedoAction.current = true;
      const prevIndex = historyIndex - 1;
      const prevState = JSON.parse(JSON.stringify(history[prevIndex]));
      setProject(prevState);
      setHistoryIndex(prevIndex);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUndoRedoAction.current = true;
      const nextIndex = historyIndex + 1;
      const nextState = JSON.parse(JSON.stringify(history[nextIndex]));
      setProject(nextState);
      setHistoryIndex(nextIndex);
    }
  }, [historyIndex, history]);

  const saveHistorySnapshot = () => {
    if (!project) return;
    ignoreHistoryChange.current = false;
    const lastState = history[historyIndex];
    if (JSON.stringify(lastState) !== JSON.stringify(project)) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(project)));
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const createNewProject = (preset: typeof PRESET_RATIOS[0]) => {
    const newProject: ProjectState = {
      id: generateId(), title: t.untitled, updatedAt: Date.now(),
      layers: [{ id: generateId(), name: lang === 'zh' ? '标题' : 'Headline', type: 'text', content: lang === 'zh' ? '点击此处编辑' : 'Tap to Edit', x: 50, y: preset.height / 2 - 50, width: preset.width - 100, height: 100, fontSize: 64, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1, color: '#ffffff', ratioLocked: true }],
      background: { 
        type: 'color', 
        value: '#1e293b', 
        overlayType: 'none', 
        overlayColor: '#ffffff', 
        overlayOpacity: 0.1, 
        overlayScale: 20 
      },
      canvasConfig: { width: preset.width, height: preset.height, ratio: preset.ratio },
      selectedLayerId: null
    };
    setProject(newProject);
    setProjects(prev => [newProject, ...prev]);
    setView('editor');
    initProjectHistory(newProject);
  };

  const modifyProject = (modifier: (p: ProjectState) => ProjectState, saveToHistory: boolean = true) => {
    if (!saveToHistory) ignoreHistoryChange.current = true;
    setProject(prev => prev ? modifier(prev) : null);
  };

  const updateLayer = useCallback((id: string, updates: Partial<Layer>, record: boolean = true) => {
    modifyProject(p => ({
      ...p,
      layers: p.layers.map(l => {
        if (l.id !== id) return l;
        const newL = { ...l, ...updates };
        if (l.ratioLocked) {
           if (updates.width !== undefined && updates.height === undefined) newL.height = updates.width * (l.height / l.width);
           else if (updates.height !== undefined && updates.width === undefined) newL.width = updates.height * (l.width / l.height);
        }
        return newL;
      })
    }), record);
  }, []);

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported: ProjectState = JSON.parse(event.target?.result as string);
        if (imported.id && imported.layers) {
          const existingProjectIds = new Set(projects.map(p => p.id));
          if (existingProjectIds.has(imported.id)) {
            imported.id = generateId();
            imported.updatedAt = Date.now();
            if (lang === 'zh') imported.title += ' (导入副本)';
            else imported.title += ' (Imported Copy)';
          }
          imported.layers = imported.layers.map(layer => ({ ...layer, id: generateId() }));
          imported.selectedLayerId = null;
          setProjects(prev => [imported, ...prev]);
          showToast(lang === 'zh' ? "导入成功" : "Imported Successfully");
        }
      } catch (err) {
        showToast(lang === 'zh' ? "解析失败" : "Parse Failed", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportJson = () => {
    if (!project) return;
    const json = JSON.stringify(project, null, 2);
    downloadFile(json, `${project.title}.json`, 'application/json');
  };

  const addTextLayerWithContent = (text: string) => {
    if (!project) return;
    modifyProject(p => {
      const width = Math.min(Math.max(200, text.length * 18), p.canvasConfig.width * 0.9);
      const height = Math.min(120, p.canvasConfig.height * 0.5);
      const newId = generateId();
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: lang === 'zh' ? '文字图层' : 'Text Layer',
          type: 'text',
          content: text,
          x: p.canvasConfig.width / 2 - width / 2,
          y: p.canvasConfig.height / 2 - height / 2,
          width,
          height,
          fontSize: 32,
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          color: '#ffffff',
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    showToast(lang === 'zh' ? "已添加文字图层" : "Text layer added");
  };

  const addSvgLayerWithContent = (svgText: string) => {
    if (!project) return;
    const normalized = normalizeSVG(svgText);
    const dims = getSVGDimensions(normalized);
    modifyProject(p => {
      const maxW = p.canvasConfig.width * 0.7;
      const maxH = p.canvasConfig.height * 0.7;
      const rawW = dims.width || 200;
      const rawH = dims.height || 200;
      const scale = Math.min(1, maxW / rawW, maxH / rawH);
      const width = Math.max(40, rawW * scale);
      const height = Math.max(40, rawH * scale);
      const newId = generateId();
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: lang === 'zh' ? 'SVG 图层' : 'SVG Layer',
          type: 'svg',
          content: normalized,
          x: p.canvasConfig.width / 2 - width / 2,
          y: p.canvasConfig.height / 2 - height / 2,
          width,
          height,
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          color: '#3b82f6',
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    showToast(lang === 'zh' ? "已添加 SVG 图层" : "SVG layer added");
  };

  const addImageLayerWithContent = (dataUrl: string) => {
    if (!project) return;
    modifyProject(p => {
      const size = Math.min(320, p.canvasConfig.width * 0.6, p.canvasConfig.height * 0.6);
      const newId = generateId();
      return {
        ...p,
        layers: [...p.layers, {
          id: newId,
          name: lang === 'zh' ? '图片图层' : 'Image Layer',
          type: 'image',
          content: dataUrl,
          x: p.canvasConfig.width / 2 - size / 2,
          y: p.canvasConfig.height / 2 - size / 2,
          width: size,
          height: size,
          rotation: 0,
          zIndex: p.layers.length + 1,
          visible: true,
          locked: false,
          opacity: 1,
          ratioLocked: true
        }],
        selectedLayerId: newId
      };
    });
    showToast(lang === 'zh' ? "已添加图片图层" : "Image layer added");
  };

  const applyProjectFromJson = (data: Partial<ProjectState>) => {
    if (!project) return;
    modifyProject(p => {
      const newLayers = (data.layers || []).map(l => ({
        ...l,
        id: generateId()
      }));

      return {
        ...p,
        layers: newLayers.length > 0 ? newLayers : p.layers,
        background: data.background || p.background,
        canvasConfig: data.canvasConfig || p.canvasConfig,
        selectedLayerId: null,
        updatedAt: Date.now()
      };
    });
    showToast(lang === 'zh' ? "已应用项目内容" : "Project content applied");
  };

  const handleAddText = () => addTextLayerWithContent(lang === 'zh' ? '新文字' : 'New Text');

  const handleAddImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => addImageLayerWithContent(ev.target?.result as string);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleExportImage = async () => {
    if (!project) return;
    setIsExporting(true);
    modifyProject(p => ({ ...p, selectedLayerId: null }), false);
    await new Promise(resolve => setTimeout(resolve, 100));
    const node = document.getElementById('export-target');
    if (node) { 
      try { 
        const dataUrl = await htmlToImage.toPng(node, { pixelRatio: 2 }); 
        const link = document.createElement('a'); 
        link.download = `${project.title}.png`; 
        link.href = dataUrl; 
        link.click(); 
        showToast(lang === 'zh' ? "导出成功" : "Exported successfully");
      } catch (e) { 
        showToast(lang === 'zh' ? "导出失败" : "Export Failed", "error"); 
      } 
    }
    setIsExporting(false);
  };

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (!project || !project.selectedLayerId) return;

      const layer = project.layers.find(l => l.id === project.selectedLayerId);
      if (!layer || layer.locked) return;

      // Enter - Activate text input box
      if (e.key === 'Enter') {
        if (layer.type === 'text') {
          e.preventDefault();
          const textarea = document.querySelector('textarea');
          if (textarea) textarea.focus();
          return;
        }
      }

      // Delete/Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        modifyProject(p => ({
          ...p,
          layers: p.layers.filter(l => l.id !== project.selectedLayerId),
          selectedLayerId: null
        }));
        return;
      }

      // COMBINATION KEYS (Ctrl + Arrow)
      if (e.ctrlKey || e.metaKey) {
        // Hierarchy Adjustment
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          modifyProject(p => {
            const index = p.layers.findIndex(l => l.id === project.selectedLayerId);
            const newLayers = [...p.layers];
            if (e.key === 'ArrowUp' && index < newLayers.length - 1) {
              [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
            } else if (e.key === 'ArrowDown' && index > 0) {
              [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
            }
            return { ...p, layers: newLayers.map((l, i) => ({ ...l, zIndex: i + 1 })) };
          });
          return;
        }

        // Rotation Adjustment
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dr = e.key === 'ArrowLeft' ? -15 : 15;
          updateLayer(project.selectedLayerId, { rotation: (layer.rotation + dr) % 360 });
          return;
        }

        // Clone (Ctrl+J)
        if (e.key.toLowerCase() === 'j') {
          e.preventDefault();
          const newId = generateId();
          const clone = { ...JSON.parse(JSON.stringify(layer)), id: newId, x: layer.x + 20, y: layer.y + 20, zIndex: project.layers.length + 1 };
          modifyProject(p => ({ ...p, layers: [...p.layers, clone], selectedLayerId: newId }));
          showToast(lang === 'zh' ? "图层已复制" : "Layer cloned");
          return;
        }
      }

      // SIMPLE MOVEMENT
      if (!e.ctrlKey && !e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        updateLayer(project.selectedLayerId, { x: layer.x + dx, y: layer.y + dy });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, handleUndo, handleRedo, updateLayer, lang]);

  useEffect(() => {
    if (view !== 'editor' || !project) return;

    const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

    const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      const files = Array.from(clipboard.files || []);
      if (files.length > 0) {
        e.preventDefault();
        for (const file of files) {
          if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
            const text = await readFileAsText(file);
            addSvgLayerWithContent(text);
          } else if (file.type.startsWith('image/')) {
            const dataUrl = await readFileAsDataUrl(file);
            addImageLayerWithContent(dataUrl);
          }
        }
        return;
      }

      const text = clipboard.getData('text/plain');
      if (!text || !text.trim()) return;

      const trimmed = text.trim();

      if (trimmed.toLowerCase().includes('<svg')) {
        e.preventDefault();
        addSvgLayerWithContent(trimmed);
        return;
      }

      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && (parsed.layers || parsed.background || parsed.canvasConfig)) {
            e.preventDefault();
            applyProjectFromJson(parsed as ProjectState);
            return;
          }
        } catch (err) {}
      }

      e.preventDefault();
      addTextLayerWithContent(trimmed);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [view, project, lang]);

  const groupedProjects = useMemo(() => {
    const filtered = projects.filter(p => p.title.toLowerCase().includes(projectSearchTerm.toLowerCase()));
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfThisWeek = startOfToday - (now.getDay() * 86400000);
    const startOfLastWeek = startOfThisWeek - (7 * 86400000);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();

    const groups: { label: string, key: string, items: ProjectState[] }[] = [
      { label: t.dateGroups.today, key: 'today', items: [] },
      { label: t.dateGroups.yesterday, key: 'yesterday', items: [] },
      { label: t.dateGroups.thisWeek, key: 'thisWeek', items: [] },
      { label: t.dateGroups.lastWeek, key: 'lastWeek', items: [] },
      { label: t.dateGroups.lastMonth, key: 'lastMonth', items: [] },
      { label: t.dateGroups.older, key: 'older', items: [] }
    ];

    filtered.forEach(p => {
      const time = p.updatedAt;
      if (time >= startOfToday) groups[0].items.push(p);
      else if (time >= startOfYesterday) groups[1].items.push(p);
      else if (time >= startOfThisWeek) groups[2].items.push(p);
      else if (time >= startOfLastWeek) groups[3].items.push(p);
      else if (time >= startOfLastMonth) groups[4].items.push(p);
      else groups[5].items.push(p);
    });

    return groups.filter(g => g.items.length > 0);
  }, [projects, projectSearchTerm, t.dateGroups]);

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 p-8 md:p-16 flex flex-col gap-12 max-w-7xl mx-auto h-screen overflow-hidden">
        {toast && <Toast message={toast.msg} type={toast.type} />}
        {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
        <div className="flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4"><div className="bg-blue-600 p-2.5 rounded-2xl shadow-xl shadow-blue-900/20"><Share2 className="w-8 h-8 text-white" /></div><div><h1 className="text-3xl font-black tracking-tight text-white">{t.title}</h1><p className="text-slate-500 text-sm font-medium">{t.landingHeader}</p></div></div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 cursor-pointer transition-all">
              <Upload className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold">{t.import}</span>
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800"><button onClick={() => setLang('zh')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'zh' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>中</button><button onClick={() => setLang('en')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'en' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>EN</button></div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 flex-1 min-h-0">
          <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-hidden">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4" /> {t.createNew}</h2>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar">
              {PRESET_RATIOS.map(ratio => (<button key={ratio.name} onClick={() => createNewProject(ratio)} className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-blue-500 hover:bg-slate-800/50 transition-all group text-left flex-shrink-0"><div className="flex items-center gap-4"><div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700 group-hover:bg-blue-900/20 transition-colors"><LayoutIcon className="w-6 h-6 text-slate-500 group-hover:text-blue-400" /></div><div><p className="text-sm font-bold text-slate-100">{lang === 'zh' ? ratio.nameZh : ratio.name}</p><p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">{ratio.width} × {ratio.height} PX</p></div></div><ChevronRight className="w-5 h-5 text-slate-700 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" /></button>))}
            </div>
          </div>
          <div className="lg:col-span-8 flex flex-col gap-6 h-full overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Clock className="w-4 h-4" /> {t.recentProjects}</h2>
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input 
                  type="text" 
                  placeholder={t.searchProjects}
                  value={projectSearchTerm}
                  onChange={(e) => setProjectSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-12 pr-4 text-xs font-medium text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 transition-all"
                />
                {projectSearchTerm && (
                  <button 
                    onClick={() => setProjectSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-8">
              {projects.length === 0 ? (
                <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl h-80 flex flex-col items-center justify-center text-slate-600 gap-4"><LayoutGrid className="w-12 h-12 opacity-20" /><p className="text-sm font-medium">{t.noProjects}</p></div>
              ) : groupedProjects.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-600 opacity-50 italic">
                  <p className="text-sm">{lang === 'zh' ? '未找到匹配的项目' : 'No matching projects found'}</p>
                </div>
              ) : (
                groupedProjects.map(group => (
                  <div key={group.key} className="space-y-4">
                    <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] border-b border-slate-900 pb-2">{group.label}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {group.items.map(p => (
                        <div key={p.id} onClick={() => { setProject(JSON.parse(JSON.stringify(p))); setView('editor'); initProjectHistory(p); }} className="group relative bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-blue-500 transition-all cursor-pointer shadow-lg hover:shadow-blue-900/10 overflow-hidden">
                          <div className="flex flex-col gap-4 relative z-10">
                            <div className="flex justify-between items-start">
                              <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center">
                                <Share2 className="w-5 h-5 text-blue-500" />
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDialog({ message: t.confirmDeleteProject, onConfirm: () => setProjects(prev => prev.filter(pr => pr.id !== p.id)) }); }} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-red-500 rounded-lg transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition-colors truncate pr-8">{p.title}</h3>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-[10px] text-slate-500 flex items-center gap-1 uppercase font-bold tracking-widest">
                                <Clock className="w-3 h-3" /> {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <span className="text-[9px] px-2 py-0.5 bg-slate-800 rounded text-slate-400 font-bold uppercase tracking-tight">
                                {p.canvasConfig.ratio}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal isOpen={true} message={confirmDialog.message} lang={lang} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => { modifyProject(p => ({...p, updatedAt: Date.now()})); setView('landing'); }} className="p-2 hover:bg-slate-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </button>
          <div className="flex items-center gap-2">
            <input value={project.title} onChange={(e) => modifyProject(p => ({ ...p, title: e.target.value }))} className="bg-transparent font-bold text-sm outline-none hover:bg-slate-800 rounded px-1" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-4 bg-slate-800 p-1 rounded-lg">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex <= 0}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-300"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
          <button onClick={handleExportJson} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-slate-300 border border-slate-700 transition-colors">
            <FileOutput className="w-4 h-4" />
            {t.exportJson}
          </button>
          <button onClick={handleExportImage} disabled={isExporting} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-lg text-white shadow-lg shadow-blue-900/20 disabled:opacity-50">
            {isExporting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            {t.export}
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        <Sidebar lang={lang} activeTab={activeTab} setActiveTab={setActiveTab} background={project.background} onAddLayer={(l) => modifyProject(p => ({ ...p, layers: [...p.layers, { id: generateId(), name: l.name || 'Layer', type: l.type || 'svg', x: p.canvasConfig.width/2-50, y: p.canvasConfig.height/2-50, width: l.width || 100, height: l.height || 100, rotation: 0, zIndex: p.layers.length+1, visible: true, locked: false, opacity: 1, color: l.color || '#3b82f6', ratioLocked: true, content: l.content || '' }] }))} onUpdateBackground={(bg) => modifyProject(p => ({ ...p, background: { ...p.background, ...bg } }))} />
        <div className="flex-1 flex flex-col min-h-0 relative">
          <Canvas lang={lang} project={project} onSelectLayer={(id) => modifyProject(p => ({ ...p, selectedLayerId: id }), false)} updateLayer={updateLayer} onCommit={saveHistorySnapshot} />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-2 shadow-2xl z-40">
            <button onClick={handleAddText} className="flex items-center gap-2 px-4 py-2 hover:bg-blue-600/10 hover:text-blue-400 rounded-xl transition-all text-xs font-bold group">
              <div className="p-1.5 bg-slate-800 rounded-lg group-hover:bg-blue-600/20"><TextIcon className="w-4 h-4" /></div>
              {t.addHeadline}
            </button>
            <div className="w-px h-6 bg-slate-800" />
            <button onClick={handleAddImage} className="flex items-center gap-2 px-4 py-2 hover:bg-blue-600/10 hover:text-blue-400 rounded-xl transition-all text-xs font-bold group">
              <div className="p-1.5 bg-slate-800 rounded-lg group-hover:bg-blue-600/20"><ImagePlus className="w-4 h-4" /></div>
              {t.addImage}
            </button>
          </div>
        </div>
        <LayersPanel lang={lang} project={project} onUpdateLayer={updateLayer} onDeleteLayer={(id) => setConfirmDialog({ message: t.confirmDelete, onConfirm: () => modifyProject(p => ({ ...p, layers: p.layers.filter(l => l.id !== id), selectedLayerId: p.selectedLayerId === id ? null : p.selectedLayerId })) })} onSelectLayer={(id) => modifyProject(p => ({ ...p, selectedLayerId: id }), false)} onReorderLayers={(newLayers) => modifyProject(p => ({ ...p, layers: newLayers.map((l, i) => ({ ...l, zIndex: i + 1 })) }))} onCommit={saveHistorySnapshot} />
      </main>
    </div>
  );
};

export default App;
