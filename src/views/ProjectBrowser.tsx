import React, { useCallback, useMemo, useState } from 'react';
import { Clock, Layers, LayoutGrid, List, Search, X } from 'lucide-react';
import { ProjectCard, ProjectListItem } from './ProjectItems.tsx';
import type { RecentProjectItem } from '../hooks/useLocalProjects.ts';
import type { ProjectState } from '../types.ts';
import { translations, type Language } from '../translations.ts';
import { getStoredTimeGroupingMode, setStoredTimeGroupingMode, getStoredProjectViewLayout,
  setStoredProjectViewLayout, type TimeGroupingMode, type ProjectViewLayout } from '../storage/storage.ts';

export type ProjectBrowserProps = {
  lang: Language;
  projects: ProjectState[];
  localRecentItems: RecentProjectItem[];
  projectSearchTerm: string;
  setProjectSearchTerm: (term: string) => void;
  isCloudMode: boolean;
  cloudLoading: boolean;
  handleProjectsScroll: React.UIEventHandler<HTMLDivElement>;
  handleOpenRecentProject: (item: RecentProjectItem) => void;
  handleDeleteRecentProject: (item: RecentProjectItem) => void;
  handleDuplicateProject: (project: ProjectState) => void;
  handleExportJson: (project: ProjectState) => void;
  handleExportImage: (node: HTMLDivElement | null, project: ProjectState) => void;
};

export default function ProjectBrowser({ lang, projects, localRecentItems, projectSearchTerm, setProjectSearchTerm,
  isCloudMode, cloudLoading, handleProjectsScroll, handleOpenRecentProject, handleDeleteRecentProject,
  handleDuplicateProject, handleExportJson, handleExportImage }: ProjectBrowserProps) {
  const t = translations[lang];
  const [timeGroupingMode, setTimeGroupingMode] = useState<TimeGroupingMode>(() => (
    getStoredTimeGroupingMode('grouped')
  ));
  const [viewLayoutMode, setViewLayoutMode] = useState<ProjectViewLayout>(() => (
    getStoredProjectViewLayout('grid')
  ));

  const handleTimeGroupingChange = useCallback((mode: TimeGroupingMode) => {
    setTimeGroupingMode(mode);
    setStoredTimeGroupingMode(mode);
  }, []);

  const handleViewLayoutChange = useCallback((layout: ProjectViewLayout) => {
    setViewLayoutMode(layout);
    setStoredProjectViewLayout(layout);
  }, []);

  const allFilteredProjects = useMemo(() => {
    const search = projectSearchTerm.toLowerCase();
    const storageItems: RecentProjectItem[] = (isCloudMode
      ? projects
      : projects.filter(p => p.title.toLowerCase().includes(search)))
      .map(project => ({ project, source: 'storage' }));
    const localItems = localRecentItems.filter(item => !search || item.project.title.toLowerCase().includes(search));
    const filtered = [...storageItems, ...localItems];
    filtered.sort((a, b) => (b.project.updatedAt || 0) - (a.project.updatedAt || 0));
    return filtered;
  }, [projects, localRecentItems, projectSearchTerm, isCloudMode]);

  const groupedProjects = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfThisWeek = startOfToday - (now.getDay() * 86400000);
    const startOfLastWeek = startOfThisWeek - (7 * 86400000);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();

    const groups: { label: string, key: string, items: RecentProjectItem[] }[] = [
      { label: t.dateGroups.today, key: 'today', items: [] },
      { label: t.dateGroups.yesterday, key: 'yesterday', items: [] },
      { label: t.dateGroups.thisWeek, key: 'thisWeek', items: [] },
      { label: t.dateGroups.lastWeek, key: 'lastWeek', items: [] },
      { label: t.dateGroups.lastMonth, key: 'lastMonth', items: [] },
      { label: t.dateGroups.older, key: 'older', items: [] }
    ];

    allFilteredProjects.forEach(item => {
      const time = item.project.updatedAt;
      if (time >= startOfToday) groups[0].items.push(item);
      else if (time >= startOfYesterday) groups[1].items.push(item);
      else if (time >= startOfThisWeek) groups[2].items.push(item);
      else if (time >= startOfLastWeek) groups[3].items.push(item);
      else if (time >= startOfLastMonth) groups[4].items.push(item);
      else groups[5].items.push(item);
    });

    return groups.filter(g => g.items.length > 0);
  }, [allFilteredProjects, t.dateGroups]);

  const renderProjectItem = (item: RecentProjectItem) => {
    const Component = viewLayoutMode === 'list' ? ProjectListItem : ProjectCard;
    return <Component
      key={`${item.source}-${item.localPath || item.project.id}`}
      project={item.project}
      lang={lang}
      sourceLabel={item.source === 'local' ? t.localProjectTag : undefined}
      showFullDate={timeGroupingMode === 'ungrouped'}
      onClick={() => handleOpenRecentProject(item)}
      onDelete={event => { event.stopPropagation(); handleDeleteRecentProject(item); }}
      onDuplicate={event => { event.stopPropagation(); handleDuplicateProject(item.project); }}
      onDownloadJson={event => { event.stopPropagation(); handleExportJson(item.project); }}
      onDownloadImage={(node, event) => { event.stopPropagation(); handleExportImage(node, item.project); }}
    />;
  };

  return (
        <div className="flex-1 min-h-0 flex flex-col gap-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <span>{t.recentProjects}</span>
              </h2>
              {allFilteredProjects.length > 0 && (
                <span className="text-[11px] font-bold text-slate-400 bg-slate-900/80 px-2.5 py-0.5 rounded-full border border-slate-800">
                  {allFilteredProjects.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* 整合控制组：排列方式与视图切换 */}
              <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl shadow-inner gap-0.5">
                {/* 按时间分组切换：单图标开关，点亮时按时间分组，熄灭时平铺展示 */}
                <button
                  type="button"
                  onClick={() => handleTimeGroupingChange(timeGroupingMode === 'grouped' ? 'ungrouped' : 'grouped')}
                  className={`p-1.5 rounded-lg transition-all ${
                    timeGroupingMode === 'grouped'
                      ? 'bg-slate-800 text-blue-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                  }`}
                  title={
                    timeGroupingMode === 'grouped'
                      ? (lang === 'zh' ? '按时间分组：已开启（点击平铺全部）' : 'Group by date: On (click to show all)')
                      : (lang === 'zh' ? '按时间分组：已关闭（点击按时间分组）' : 'Group by date: Off (click to group by date)')
                  }
                  aria-label={lang === 'zh' ? '按时间分组' : 'Group by date'}
                  aria-pressed={timeGroupingMode === 'grouped'}
                >
                  <Layers className="w-4 h-4" />
                </button>

                <div className="w-px h-4 bg-slate-800 mx-1 self-center" />

                {/* 视图切换：网格 / 列表 */}
                <button
                  type="button"
                  onClick={() => handleViewLayoutChange('grid')}
                  className={`p-1.5 rounded-lg transition-all ${
                    viewLayoutMode === 'grid'
                      ? 'bg-slate-800 text-blue-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                  }`}
                  title={t.viewGrid}
                  aria-label={t.viewGrid}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleViewLayoutChange('list')}
                  className={`p-1.5 rounded-lg transition-all ${
                    viewLayoutMode === 'list'
                      ? 'bg-slate-800 text-blue-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                  }`}
                  title={t.viewList}
                  aria-label={t.viewList}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              {/* 搜索框 */}
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input 
                  type="text" 
                  placeholder={t.searchProjects}
                  value={projectSearchTerm}
                  onChange={(e) => setProjectSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-9 pr-8 text-xs font-medium text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 transition-all"
                />
                {projectSearchTerm && (
                  <button 
                    type="button"
                    onClick={() => setProjectSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-10 pb-16" onScroll={handleProjectsScroll}>
            {projects.length === 0 && localRecentItems.length === 0 ? (
              <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl h-80 flex flex-col items-center justify-center text-slate-600 gap-4"><LayoutGrid className="w-12 h-12 opacity-20" /><p className="text-sm font-medium">{t.noProjects}</p></div>
            ) : allFilteredProjects.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-600 opacity-50 italic">
                <p className="text-sm">{t.noMatchingProjects}</p>
              </div>
            ) : timeGroupingMode === 'grouped' ? (
              groupedProjects.map(group => (
                <div key={group.key} className="space-y-4">
                  <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] flex items-center gap-4">
                    <span>{group.label}</span>
                    <span className="text-[10px] font-bold text-slate-700 tracking-normal">({group.items.length})</span>
                    <div className="flex-1 h-px bg-slate-900"></div>
                  </h3>
                  <div className={viewLayoutMode === 'list' ? 'flex flex-col gap-3' : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6'}>
                    {group.items.map(renderProjectItem)}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-4">
                <div className={viewLayoutMode === 'list' ? 'flex flex-col gap-3' : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6'}>
                  {allFilteredProjects.map(renderProjectItem)}
                </div>
              </div>
            )}
            {isCloudMode && cloudLoading && (
              <div className="flex items-center justify-center py-6 text-xs text-slate-500">{t.loading || 'Loading...'}</div>
            )}
          </div>
        </div>
  );
}
