import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type EditorViewMode = 'code' | 'split' | 'preview'
export type MarkdownPreviewMode = 'view' | 'edit'

export interface UserEditorPreference {
  viewMode: EditorViewMode
  splitPercent: number
  isLiveRenderActive: boolean
  syncScroll: boolean
  showOutline?: boolean
  previewMode?: MarkdownPreviewMode
}

const DEFAULT_PREFERENCE: UserEditorPreference = {
  viewMode: 'split',
  splitPercent: 50,
  isLiveRenderActive: true,
  syncScroll: true,
  showOutline: false,
  previewMode: 'view',
}

interface EditorPreferenceState {
  preferencesByUser: Record<string, UserEditorPreference>
  getUserPreference: (userId?: string | null) => UserEditorPreference
  setViewMode: (userId: string | null | undefined, mode: EditorViewMode) => void
  setSplitPercent: (userId: string | null | undefined, percent: number) => void
  setIsLiveRenderActive: (
    userId: string | null | undefined,
    active: boolean
  ) => void
  setSyncScroll: (
    userId: string | null | undefined,
    syncScroll: boolean
  ) => void
  setShowOutline: (
    userId: string | null | undefined,
    showOutline: boolean
  ) => void
  setPreviewMode: (
    userId: string | null | undefined,
    previewMode: MarkdownPreviewMode
  ) => void
}

export const useEditorPreferenceStore = create<EditorPreferenceState>()(
  persist(
    (set, get) => ({
      preferencesByUser: {},

      getUserPreference: (userId) => {
        const key = userId || 'guest'
        return get().preferencesByUser[key] ?? DEFAULT_PREFERENCE
      },

      setViewMode: (userId, viewMode) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                viewMode,
              },
            },
          }
        })
      },

      setSplitPercent: (userId, splitPercent) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                splitPercent,
              },
            },
          }
        })
      },

      setIsLiveRenderActive: (userId, isLiveRenderActive) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                isLiveRenderActive,
              },
            },
          }
        })
      },

      setSyncScroll: (userId, syncScroll) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                syncScroll,
              },
            },
          }
        })
      },

      setShowOutline: (userId, showOutline) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                showOutline,
              },
            },
          }
        })
      },

      setPreviewMode: (userId, previewMode) => {
        const key = userId || 'guest'
        set((state) => {
          const current = state.preferencesByUser[key] ?? DEFAULT_PREFERENCE
          return {
            preferencesByUser: {
              ...state.preferencesByUser,
              [key]: {
                ...current,
                previewMode,
              },
            },
          }
        })
      },
    }),
    {
      name: 'dokudocs-editor-user-preferences',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
