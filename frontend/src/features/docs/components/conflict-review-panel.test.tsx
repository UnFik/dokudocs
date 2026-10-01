import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import type { ReviewModel } from '../lib/collaboration-review'
import {
  ConflictReviewPanel,
  type ConflictReviewActions,
} from './conflict-review-panel'

const node = (content: string) => ({
  nodeID: 'r1',
  parentID: 'p1',
  siblingOrder: 1,
  type: 'run',
  content,
  attributes: {},
})

function model(overrides: Partial<ReviewModel> = {}): ReviewModel {
  return {
    canEdit: true,
    held: [
      {
        nodeID: 'r1',
        reason: 'concurrent-edit',
        local: node('my wording'),
        canonical: node('their wording'),
      },
    ],
    commands: [],
    pendingDiff: [],
    ...overrides,
  }
}

function actions(
  overrides: Partial<ConflictReviewActions> = {}
): ConflictReviewActions {
  return {
    copyText: vi.fn(async () => {}),
    acceptHeld: vi.fn(async () => {}),
    discardLocal: vi.fn(async () => {}),
    dismissHeld: vi.fn(async () => {}),
    resolveCommand: vi.fn(async () => {}),
    exportLocal: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('ConflictReviewPanel', () => {
  it('shows both versions of a held edit and copies the local text with edit access', async () => {
    const a = actions()
    await render(<ConflictReviewPanel load={async () => model()} actions={a} />)
    await expect.element(page.getByText('my wording')).toBeVisible()
    await expect.element(page.getByText('their wording')).toBeVisible()
    await page.getByRole('button', { name: 'Copy your version' }).click()
    expect(a.copyText).toHaveBeenCalledWith('my wording')
  })

  it('disables copy and says why when edit access is gone', async () => {
    await render(
      <ConflictReviewPanel
        load={async () => model({ canEdit: false })}
        actions={actions()}
      />
    )
    await expect
      .element(page.getByRole('button', { name: 'Copy your version' }))
      .toBeDisabled()
    await expect
      .element(page.getByText(/no longer have edit access/i))
      .toBeVisible()
  })

  it('explains a held delete and offers delete anyway or keep the block', async () => {
    const a = actions()
    await render(
      <ConflictReviewPanel
        load={async () =>
          model({
            held: [],
            commands: [
              {
                kind: 'delete',
                commandID: 'c1',
                nodeID: 'p2',
                explanation: {
                  code: 'content-changed',
                  message:
                    'This block changed on the server after you deleted it.',
                  canForce: true,
                  canReissue: false,
                },
              },
            ],
          })
        }
        actions={a}
      />
    )
    await expect
      .element(page.getByText(/changed on the server after you deleted it/))
      .toBeVisible()
    await page.getByRole('button', { name: 'Delete anyway' }).click()
    expect(a.resolveCommand).toHaveBeenCalledWith('delete', 'c1', 'force')
    await page.getByRole('button', { name: 'Keep the block' }).click()
    expect(a.resolveCommand).toHaveBeenCalledWith('delete', 'c1', 'cancel')
  })

  it('offers only cancel for a move that cannot be re-issued', async () => {
    await render(
      <ConflictReviewPanel
        load={async () =>
          model({
            held: [],
            commands: [
              {
                kind: 'move',
                commandID: 'm1',
                nodeID: 'p2',
                explanation: {
                  code: 'target-missing',
                  message:
                    'The place you moved this block to no longer exists.',
                  canForce: false,
                  canReissue: false,
                },
              },
            ],
          })
        }
        actions={actions()}
      />
    )
    await expect
      .element(page.getByRole('button', { name: 'Cancel the move' }))
      .toBeVisible()
    expect(
      page.getByRole('button', { name: 'Delete anyway' }).elements()
    ).toHaveLength(0)
  })

  it('asks before discarding all local changes', async () => {
    const a = actions()
    await render(<ConflictReviewPanel load={async () => model()} actions={a} />)
    await page.getByRole('button', { name: 'Discard local changes' }).click()
    expect(a.discardLocal).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Discard on this device' }).click()
    expect(a.discardLocal).toHaveBeenCalledTimes(1)
  })

  it('shows an error with retry when loading fails, and an empty state when nothing is left', async () => {
    let attempts = 0
    await render(
      <ConflictReviewPanel
        load={async () => {
          attempts++
          if (attempts === 1) throw new Error('offline')
          return model({ held: [] })
        }}
        actions={actions()}
      />
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('offline')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect
      .element(page.getByText('Nothing left to review.'))
      .toBeVisible()
  })

  it('reloads after dismissing held edits', async () => {
    const load = vi
      .fn<() => Promise<ReviewModel>>()
      .mockResolvedValueOnce(model())
      .mockResolvedValueOnce(model({ held: [] }))
    await render(<ConflictReviewPanel load={load} actions={actions()} />)
    await page.getByRole('button', { name: 'Keep server version' }).click()
    await expect
      .element(page.getByText('Nothing left to review.'))
      .toBeVisible()
  })

  it('applies your version of a held edit when you can edit', async () => {
    const a = actions()
    await render(<ConflictReviewPanel load={async () => model()} actions={a} />)
    await page.getByRole('button', { name: 'Use my version' }).click()
    expect(a.acceptHeld).toHaveBeenCalledWith('r1')
  })

  it('disables Use my version without edit access', async () => {
    await render(
      <ConflictReviewPanel
        load={async () => model({ canEdit: false })}
        actions={actions()}
      />
    )
    await expect
      .element(page.getByRole('button', { name: 'Use my version' }))
      .toBeDisabled()
  })

  it('offers to re-issue a held move that can still be applied', async () => {
    const a = actions()
    await render(
      <ConflictReviewPanel
        load={async () =>
          model({
            held: [],
            commands: [
              {
                kind: 'move',
                commandID: 'm1',
                nodeID: 'p2',
                explanation: {
                  code: 'before-missing',
                  message:
                    'The block you placed it before was moved or deleted.',
                  canForce: false,
                  canReissue: true,
                },
              },
            ],
          })
        }
        actions={a}
      />
    )
    await page.getByRole('button', { name: 'Move to the end instead' }).click()
    expect(a.resolveCommand).toHaveBeenCalledWith('move', 'm1', 'reissue')
  })
})
