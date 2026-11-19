import { pagePreviewFingerprint } from './projectPreviews.ts';
import type { ProjectPage } from '../types.ts';

self.onmessage = (event: MessageEvent<Pick<ProjectPage, 'layers' | 'pageInfo'>>) => {
  self.postMessage(pagePreviewFingerprint({ ...event.data, id: '', name: '' }));
};