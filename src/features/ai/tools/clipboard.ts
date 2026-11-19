import type { ClipboardEntry } from '../../../utils/layerClipboard.ts';
import type { WorkspaceBridge } from '../types.ts';
import { ensureProjectFonts } from '../services/fontLoading.ts';
import { choice, record, text } from './validation.ts';

export async function executeClipboardTool(input: unknown, bridge: WorkspaceBridge, signal: AbortSignal) {
  signal.throwIfAborted();
  const args = record(input);
  const action = choice(args.action, 'action', ['check', 'clear', 'copy', 'paste']);
  const allowed = action === 'copy' ? ['action', 'layers'] : action === 'paste' ? ['action', 'projectId', 'pageId'] : ['action'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported clipboard parameter.');
  const clipboard = bridge.clipboard;
  if (!clipboard) throw new Error('Clipboard is unavailable.');
  const resolve = async (projectId: string) => {
    const current = bridge.getProject();
    if (current?.id === projectId) return current;
    if (!bridge.getProjectById) throw new Error('Project lookup is unavailable.');
    return bridge.getProjectById(projectId);
  };
  if (action === 'clear') { clipboard.clear(); return { success: true }; }
  if (action === 'check') { const layers = await clipboard.check(resolve); signal.throwIfAborted(); return { layers }; }
  if (action === 'copy') {
    if (!Array.isArray(args.layers)) throw new Error('layers must be an array.');
    if (!args.layers.length || args.layers.length > 500) throw new Error('Clipboard requires 1-500 entries.');
    const current = bridge.getProject();
    const layers = args.layers.map(input => {
      const entry = record(input);
      if (entry.projectId === undefined && !current) throw new Error('Open a project or provide a source projectId.');
      if (entry.pageId === undefined && !current?.activePageId) throw new Error('Open a page or provide a source pageId.');
      return { ...entry, projectId: entry.projectId === undefined ? current!.id : entry.projectId, pageId: entry.pageId === undefined ? current!.activePageId : entry.pageId } as ClipboardEntry;
    });
    return { success: true, ...await clipboard.copy(layers, resolve, signal) };
  }
  const current = bridge.getProject();
  if (!current) throw new Error('Open the target project before pasting.');
  const projectId = text(args.projectId === undefined ? current.id : args.projectId, 'projectId');
  const pageId = text(args.pageId === undefined ? current.activePageId : args.pageId, 'pageId');
  if (current.id !== projectId) throw new Error('Open the target project before pasting.');
  const result = await clipboard.paste(current, pageId, resolve, signal);
  await ensureProjectFonts(result.project);
  signal.throwIfAborted();
  if (bridge.getProject() !== current) throw new Error('The active project changed while pasting. Read get_context again.');
  try { await bridge.commit(result.project); }
  catch (error) { throw new Error(`Paste may have been applied but could not be saved. Check the target before retrying. Created layer IDs: ${result.createdLayerIds.join(', ')}. ${error instanceof Error ? error.message : ''}`); }
  return { success: true, projectId, pageId, createdLayerIds: result.createdLayerIds };
}