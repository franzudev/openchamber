// Sessions that run in an existing git worktree of a configured project only
// reach the sidebar once OpenChamber has fetched the session list for that
// worktree's directory. The published worktree topology in the session UI
// store is the authoritative view of which directories exist, so every
// published directory gets exactly one session-list fetch here. Directories
// that leave the topology are forgotten, so a worktree recreated at the same
// path is fetched again, and a failed fetch is retried by the next publish.
import { normalizePath } from '@/lib/pathNormalization';
import { refreshGlobalSessionsForDirectories } from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

const hydratedDirectories = new Set<string>();

export const hydrateSessionsForPublishedWorktrees = (
  worktreesByProject: ReadonlyMap<string, readonly { path: string }[]>,
): void => {
  const published = new Set<string>();
  for (const [projectRoot, worktrees] of worktreesByProject) {
    const root = normalizePath(projectRoot);
    for (const worktree of worktrees) {
      const directory = normalizePath(worktree.path);
      // The main worktree duplicates the project root, whose sessions the
      // regular project bootstrap already loads.
      if (directory && directory !== root) {
        published.add(directory);
      }
    }
  }
  for (const directory of hydratedDirectories) {
    if (!published.has(directory)) {
      hydratedDirectories.delete(directory);
    }
  }
  const pending: string[] = [];
  for (const directory of published) {
    if (hydratedDirectories.has(directory)) {
      continue;
    }
    hydratedDirectories.add(directory);
    pending.push(directory);
  }
  if (pending.length === 0) {
    return;
  }
  void refreshGlobalSessionsForDirectories(pending).catch(() => {
    for (const directory of pending) {
      hydratedDirectories.delete(directory);
    }
  });
};

/** Drops the hydration memory; used by tests to isolate each run. */
export const resetWorktreeSessionHydration = (): void => {
  hydratedDirectories.clear();
};

let watchingTopology = false;

/**
 * Watches published worktree topology changes and hydrates the session list
 * of every directory that enters it. Idempotent; call once at startup.
 */
export const startWorktreeSessionHydration = (): void => {
  if (watchingTopology) {
    return;
  }
  watchingTopology = true;
  useSessionUIStore.subscribe((state, previous) => {
    if (state.availableWorktreesByProject !== previous.availableWorktreesByProject) {
      hydrateSessionsForPublishedWorktrees(state.availableWorktreesByProject);
    }
  });
  hydrateSessionsForPublishedWorktrees(useSessionUIStore.getState().availableWorktreesByProject);
};
