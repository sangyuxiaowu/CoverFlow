import { useEffect, useState } from 'react';
import { readModel, readRuntime, readSettings, subscribeResources } from './storage.ts';
import type { RemovalSettings, StoredModel } from './types.ts';

interface ResourceState {
  settings: RemovalSettings;
  models: { u2netp?: StoredModel; birefnet?: StoredModel };
  runtime: boolean;
  loading: boolean;
  error: string;
}

export function useResources(): ResourceState {
  const [state, setState] = useState<ResourceState>({
    settings: { modelId: 'u2netp', device: 'auto' }, models: {}, runtime: false, loading: true, error: ''
  });
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const [settings, runtime, u2netp, birefnet] = await Promise.all([
          readSettings(), readRuntime(), readModel('u2netp'), readModel('birefnet')
        ]);
        if (mounted && current === revision) setState({ settings, models: { u2netp, birefnet }, runtime: !!runtime, loading: false, error: '' });
      } catch (error) {
        if (mounted && current === revision) setState(previous => ({ ...previous, loading: false,
          error: error instanceof Error ? error.message : String(error) }));
      }
    };
    const unsubscribe = subscribeResources(() => { void refresh(); });
    void refresh();
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return state;
}