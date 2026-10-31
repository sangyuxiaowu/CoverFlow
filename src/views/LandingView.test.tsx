// @vitest-environment jsdom
import { act, useState, type MouseEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LandingView from './LandingView.tsx';
import type { ProjectBrowserProps } from './ProjectBrowser.tsx';
import type { ProjectState } from '../types.ts';
import { translations } from '../translations.ts';
import { getStoredProjectViewLayout, getStoredTimeGroupingMode } from '../storage/storage.ts';

type ItemProps = {
  project: ProjectState;
  showFullDate: boolean;
  onClick: () => void;
  onDelete: (event: MouseEvent) => void;
};
vi.mock('./ProjectItems.tsx', () => ({
  ProjectCard: ({ project, showFullDate, onClick, onDelete }: ItemProps) => (
    <div data-project={project.id} data-layout="grid" data-full-date={showFullDate} onClick={onClick}>
      {project.title}<button onClick={onDelete}>Delete {project.id}</button>
    </div>
  ),
  ProjectListItem: ({ project, showFullDate, onClick, onDelete }: ItemProps) => (
    <div data-project={project.id} data-layout="list" data-full-date={showFullDate} onClick={onClick}>
      {project.title}<button onClick={onDelete}>Delete {project.id}</button>
    </div>
  )
}));
vi.mock('../components/pwa/PWAInstallButton.tsx', () => ({ PWAInstallButton: () => null }));

const roots = new Set<Root>();
const t = translations.en;
const today = new Date(2026, 9, 18, 12).getTime();
const makeProject = (id: string, title: string, updatedAt: number): ProjectState => ({
  id, title, updatedAt, layers: [], selectedLayerId: null,
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 },
  canvasConfig: { width: 100, height: 100, ratio: '1:1' }
});
const older = makeProject('old', 'Older cover', today - 90 * 86400000);
const recent = makeProject('recent', 'Recent cover', today);
const local = { project: makeProject('local', 'Local cover', today - 86400000), source: 'local' as const, localPath: 'cover.cfj' };

async function mount(overrides: Partial<ProjectBrowserProps> = {}) {
  const props: ProjectBrowserProps = {
    lang: 'en', projects: [older, recent], localRecentItems: [local], projectSearchTerm: '',
    setProjectSearchTerm: vi.fn(), isCloudMode: false, cloudLoading: false, handleProjectsScroll: vi.fn(),
    handleOpenRecentProject: vi.fn(), handleDeleteRecentProject: vi.fn(), handleDuplicateProject: vi.fn(),
    handleExportJson: vi.fn(), handleExportImage: vi.fn(), ...overrides
  };
  const commands = { openPresetModal: vi.fn(), openLocalProjectDialog: vi.fn(), handleImportJson: vi.fn(),
    onToggleAi: vi.fn(), onOpenStorageSettings: vi.fn(), onLanguageChange: vi.fn() };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  function Harness({ current }: { current: ProjectBrowserProps }) {
    const [search, setSearch] = useState(current.projectSearchTerm);
    return <LandingView {...current} {...commands} aiBusy={false} isAiOpen={false} isTauri={true}
      projectSearchTerm={search} setProjectSearchTerm={term => { current.setProjectSearchTerm(term); setSearch(term); }}>
      <div data-modal="preset" />
    </LandingView>;
  }
  await act(async () => root.render(<Harness current={props} />));
  return { props, commands, container, root };
}

function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(today);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.clear();
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('merges storage/local projects by date and persists grouping and layout preferences', async () => {
  const { container } = await mount();
  const ids = () => [...container.querySelectorAll('[data-project]')].map(element => element.getAttribute('data-project'));
  expect(ids()).toEqual(['recent', 'local', 'old']);
  expect(container.textContent).toContain(t.dateGroups.today);
  expect(container.textContent).toContain(t.dateGroups.yesterday);
  expect(container.textContent).toContain(t.dateGroups.older);
  await act(async () => button(container, 'Group by date').click());
  await act(async () => button(container, t.viewList).click());
  expect(getStoredTimeGroupingMode()).toBe('ungrouped');
  expect(getStoredProjectViewLayout()).toBe('list');
  expect(container.querySelector('[data-layout="grid"]')).toBeNull();
  expect(container.querySelectorAll('[data-full-date="true"]')).toHaveLength(3);
  const remounted = await mount();
  expect(remounted.container.querySelectorAll('[data-layout="list"]')).toHaveLength(3);
  expect(button(remounted.container, 'Group by date').getAttribute('aria-pressed')).toBe('false');
});

it('filters titles case-insensitively and leaves server-filtered cloud results intact', async () => {
  const { container } = await mount({ projectSearchTerm: 'LOCAL' });
  expect(container.querySelectorAll('[data-project]')).toHaveLength(1);
  expect(container.querySelector('[data-project="local"]')).not.toBeNull();
  const cloud = await mount({ isCloudMode: true, projectSearchTerm: 'unmatched' });
  expect(cloud.container.querySelectorAll('[data-project]')).toHaveLength(2);
  expect(cloud.container.querySelector('[data-project="local"]')).toBeNull();
});

it('distinguishes no projects from no search matches', async () => {
  const empty = await mount({ projects: [], localRecentItems: [] });
  expect(empty.container.textContent).toContain(t.noProjects);
  const unmatched = await mount({ projectSearchTerm: 'missing' });
  expect(unmatched.container.textContent).toContain(t.noMatchingProjects);
});

it('routes local/storage actions without deletion opening a project and retains modal content', async () => {
  const { container, props, commands } = await mount();
  await act(async () => (container.querySelector('[data-project="local"]') as HTMLElement).click());
  expect(props.handleOpenRecentProject).toHaveBeenCalledWith(local);
  await act(async () => button(container, 'Delete recent').click());
  expect(props.handleDeleteRecentProject).toHaveBeenCalledWith({ project: recent, source: 'storage' });
  expect(props.handleOpenRecentProject).toHaveBeenCalledOnce();
  await act(async () => button(container, t.createNew).click());
  await act(async () => button(container, 'AI Assistant').click());
  expect(commands.openPresetModal).toHaveBeenCalledOnce();
  expect(commands.onToggleAi).toHaveBeenCalledOnce();
  expect(container.querySelector('[data-modal="preset"]')).not.toBeNull();
});

it('uses consistent readable page-count badges in actual cards and rows, hiding single-page badges', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const { ProjectCard, ProjectListItem } = await vi.importActual<typeof import('./ProjectItems.tsx')>('./ProjectItems.tsx');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  for (const Item of [ProjectCard, ProjectListItem]) {
    for (const count of [1, 6, 99]) {
      const project = makeProject('badge', 'Cover', today);
      project.pages = Array.from({ length: count }, (_, index) => ({ id: `page-${index}`, name: '', layers: [], background: project.background, canvasConfig: project.canvasConfig }));
      for (const lang of ['zh', 'en'] as const) {
        await act(async () => root.render(<Item project={project} lang={lang} onClick={() => {}} onDelete={() => {}} onDownloadJson={() => {}} onDownloadImage={() => {}} onDuplicate={() => {}} />));
        const badge = container.querySelector('[role="img"]');
        if (count === 1) {
          expect(badge).toBeNull();
        } else {
          expect(badge?.getAttribute('aria-label')).toBe(`${count} ${lang === 'zh' ? '页' : 'pages'}`);
          expect(badge?.getAttribute('title')).toBe(badge?.getAttribute('aria-label'));
          expect(badge?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
          expect(badge?.classList.contains('h-6')).toBe(true);
          expect(badge?.parentElement?.classList.contains('opacity-60')).toBe(false);
        }
      }
    }
  }
});