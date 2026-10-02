import {
  getLocalUserScope,
  isLocalUserScopeCurrent,
  registerLocalUserFlush,
} from '@/lib/user-storage'

type Scope = ReturnType<typeof getLocalUserScope>
const widgets = new Map<() => void, Scope>()

export function registerEditorWidgetFlush(scope: Scope, flush: () => void) {
  widgets.set(flush, scope)
  const unregister = registerLocalUserFlush(flush)
  return () => {
    widgets.delete(flush)
    unregister()
  }
}

export function flushEditorWidgets(scope: Scope) {
  if (!isLocalUserScopeCurrent(scope)) return
  for (const [flush, owner] of widgets) {
    if (owner.generation === scope.generation) flush()
  }
}
