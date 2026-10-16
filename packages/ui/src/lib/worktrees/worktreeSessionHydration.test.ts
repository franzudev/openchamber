import { beforeEach, describe, expect, mock, test } from 'bun:test';

const refreshCalls: string[][] = [];
let refreshImpl: (directories: string[]) => Promise<unknown> = async () => ({ ok: true });

mock.module('@/stores/useGlobalSessionsStore', () => ({
  refreshGlobalSessionsForDirectories: (directories: Iterable<string>) => {
    const list = [...directories];
    refreshCalls.push(list);
    return refreshImpl(list);
  },
}));

type UiState = { availableWorktreesByProject: Map<string, { path: string }[]> };
type Listener = (state: UiState, previous: UiState) => void;
const uiListeners = new Set<Listener>();
let uiState: UiState = { availableWorktreesByProject: new Map() };

const setUiState = (patch: Partial<UiState>): void => {
  const previous = uiState;
  uiState = { ...uiState, ...patch };
  for (const listener of uiListeners) {
    listener(uiState, previous);
  }
};

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    subscribe: (listener: Listener) => {
      uiListeners.add(listener);
      return () => uiListeners.delete(listener);
    },
    getState: () => uiState,
    setState: setUiState,
  },
}));

const {
  hydrateSessionsForPublishedWorktrees,
  resetWorktreeSessionHydration,
  startWorktreeSessionHydration,
} = await import('./worktreeSessionHydration');

const topology = (paths: string[]): Map<string, { path: string }[]> =>
  new Map([['/repo', paths.map((path) => ({ path }))]]);

describe('worktree session hydration', () => {
  beforeEach(() => {
    refreshCalls.length = 0;
    refreshImpl = async () => ({ ok: true });
    resetWorktreeSessionHydration();
  });

  test('fetches each published worktree directory once', async () => {
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a', '/wt/b']));
    await Promise.resolve();
    expect(refreshCalls).toEqual([['/wt/a', '/wt/b']]);
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a', '/wt/b']));
    await Promise.resolve();
    expect(refreshCalls).toHaveLength(1);
  });

  test('skips the main worktree that duplicates the project root', async () => {
    hydrateSessionsForPublishedWorktrees(topology(['/repo/', '/repo/sub', '/wt/a']));
    await Promise.resolve();
    expect(refreshCalls).toEqual([['/repo/sub', '/wt/a']]);
  });

  test('refetches a worktree recreated at the same path', async () => {
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a']));
    await Promise.resolve();
    hydrateSessionsForPublishedWorktrees(topology([]));
    await Promise.resolve();
    expect(refreshCalls).toHaveLength(1);
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a']));
    await Promise.resolve();
    expect(refreshCalls).toHaveLength(2);
    expect(refreshCalls[1]).toEqual(['/wt/a']);
  });

  test('retries directories whose fetch failed', async () => {
    refreshImpl = () => Promise.reject(new Error('offline'));
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a']));
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshCalls).toEqual([['/wt/a']]);
    refreshImpl = async () => ({ ok: true });
    hydrateSessionsForPublishedWorktrees(topology(['/wt/a']));
    await Promise.resolve();
    expect(refreshCalls).toHaveLength(2);
    expect(refreshCalls[1]).toEqual(['/wt/a']);
  });

  test('hydrates directories as the topology store publishes them', async () => {
    startWorktreeSessionHydration();
    expect(refreshCalls).toHaveLength(0);
    setUiState({ availableWorktreesByProject: topology(['/repo', '/wt/a']) });
    await Promise.resolve();
    expect(refreshCalls).toEqual([['/wt/a']]);
    setUiState({ availableWorktreesByProject: topology(['/repo']) });
    await Promise.resolve();
    setUiState({ availableWorktreesByProject: topology(['/repo', '/wt/a']) });
    await Promise.resolve();
    expect(refreshCalls).toHaveLength(2);
    expect(refreshCalls[1]).toEqual(['/wt/a']);
  });
});
