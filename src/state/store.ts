// A minimal observable store: shallow-merged immutable state, synchronous notification, a
// `batch()` that coalesces several updates into one notification, and `select()` for views that
// only care about one slice. Listener errors are contained so one broken view cannot stop the rest.

export interface Store<S extends object> {
  get(): S;
  set(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: (state: S, prev: S) => void): () => void;
  /** Subscribe to a derived value; `listener` runs only when it changes (by `equals`, default Object.is). */
  select<T>(
    selector: (state: S) => T,
    listener: (value: T, prev: T) => void,
    equals?: (a: T, b: T) => boolean
  ): () => void;
  /** Apply several `set()` calls with a single notification at the end. */
  batch(fn: () => void): void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  let lastNotified = initial;
  const listeners = new Set<(state: S, prev: S) => void>();
  let batching = 0;
  let notifying = false;
  let pending = false;

  const notify = (): void => {
    if (batching > 0) {
      pending = true;
      return;
    }
    if (notifying) {
      pending = true;
      return;
    }
    notifying = true;
    try {
      do {
        pending = false;
        const prev = lastNotified;
        const current = state;
        if (current === prev) continue;
        lastNotified = current;
        for (const listener of [...listeners]) {
          try {
            listener(current, prev);
          } catch (err) {
            console.error("[schema-explorer] store listener failed", err);
          }
        }
      } while (pending);
    } finally {
      notifying = false;
    }
  };

  return {
    get: () => state,
    set(patch) {
      const resolved = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...resolved };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(selector, listener, equals = Object.is) {
      return this.subscribe((current, prev) => {
        const value = selector(current);
        const before = selector(prev);
        if (!equals(value, before)) listener(value, before);
      });
    },
    batch(fn) {
      batching += 1;
      try {
        fn();
      } finally {
        batching -= 1;
        if (batching === 0 && pending) notify();
      }
    }
  };
}

/** Element-wise identity comparison for arrays (for `select` on list slices). */
export function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}
