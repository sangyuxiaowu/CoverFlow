export function waitForPreviewTask<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', abort, { once: true });
    task.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

export function waitForPreviewIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    let handle = 0;
    const idle = typeof window.requestIdleCallback === 'function';
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const schedule = () => {
      if (idle) handle = window.requestIdleCallback(deadline => {
        const scheduling = navigator as Navigator & { scheduling?: { isInputPending: () => boolean } };
        if (deadline.timeRemaining() < 8 || scheduling.scheduling?.isInputPending()) { schedule(); return; }
        cleanup();
        resolve();
      });
      else handle = window.setTimeout(() => { cleanup(); resolve(); }, 120);
    };
    signal.addEventListener('abort', abort, { once: true });
    schedule();
  });
}