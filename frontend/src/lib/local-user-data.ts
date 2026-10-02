import {
  flushLocalUser,
  getLocalUserScope,
  switchLocalUser as changeUser,
} from './user-storage'
import { useCommentStore } from '@/stores/comment-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'

export { getLocalUserScope }

export function switchLocalUser(userId: string | null) {
  flushLocalUser()
  persistCurrentUser()
  changeUser(userId)
  if (!userId) {
    useDokudocsStore.setState({
      documents: [],
      projects: [],
      trash: [],
      revisions: {},
      documentAccesses: {},
      projectMembers: {},
    })
    useCommentStore.setState({ threads: [], activeThreadId: null })
    return
  }
  rehydrateStore(useDokudocsStore, 'dokudocs-workspace-storage')
  rehydrateStore(useCommentStore, 'dokudocs-comments-storage')
  rehydrateStore(
    useEditorPreferenceStore,
    'dokudocs-editor-user-preferences'
  )
}

function persistCurrentUser() {
  const current = getLocalUserScope().userId
  if (!current) return
  const save = (name: string, state: unknown) =>
    localStorage.setItem(`${name}:${current}`, JSON.stringify({ state, version: 0 }))
  save('dokudocs-workspace-storage', useDokudocsStore.getState())
  save('dokudocs-comments-storage', useCommentStore.getState())
  save(
    'dokudocs-editor-user-preferences',
    useEditorPreferenceStore.getState()
  )
}

function rehydrateStore<T extends object>(
  store: { setState: (state: Partial<T>) => void },
  name: string
) {
  const raw = localStorage.getItem(`${name}:${userId()}`)
  if (!raw) return
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'state' in parsed &&
      parsed.state &&
      typeof parsed.state === 'object'
    ) {
      store.setState(parsed.state as Partial<T>)
    }
  } catch {
    // Ignore corrupt local data and keep the in-memory defaults.
  }
}

function userId() {
  return getLocalUserScope().userId ?? ''
}
