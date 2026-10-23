// Counts how often components of one type render, through the hook React DevTools
// uses. Import this module before anything that imports react-dom: React reads
// the hook once, when it loads.

type Fiber = {
  type: unknown
  flags: number
  memoizedProps: Record<string, unknown> | null
  child: Fiber | null
  sibling: Fiber | null
}

// React's flag on a fiber whose component function ran in this commit.
const PERFORMED_WORK = 1

let watched: unknown = null
let seen = new Set<Fiber>()
let renders: string[] = []
let lastRoot: { current: Fiber } | null = null

function collect(fiber: Fiber | null, found: (f: Fiber) => void) {
  for (let f = fiber; f; f = f.sibling) {
    if (f.type === watched) found(f)
    collect(f.child, found)
  }
}

const hook = {
  supportsFiber: true,
  renderers: new Map(),
  inject(renderer: unknown) {
    const id = hook.renderers.size + 1
    hook.renderers.set(id, renderer)
    return id
  },
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
  onCommitFiberRoot(_id: number, root: { current: Fiber }) {
    lastRoot = root
    if (!watched) return
    const now = new Set<Fiber>()
    collect(root.current.child, (f) => {
      now.add(f)
      // A fiber left untouched keeps its object; one React went through is its alternate.
      if (!seen.has(f) && f.flags & PERFORMED_WORK)
        renders.push(String(f.memoizedProps?.id))
    })
    seen = now
  },
}

;(globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook

/** Starts counting renders of `component`; the ids of what rendered since come back from `rendered()`. */
export function countRenders(component: unknown) {
  watched = component
  renders = []
  // What is on screen now is the baseline; only later commits count.
  seen = new Set()
  if (lastRoot) collect(lastRoot.current.child, (f) => seen.add(f))
  return {
    rendered: () => [...new Set(renders)].sort(),
    reset: () => {
      renders = []
    },
  }
}
