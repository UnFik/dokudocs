import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { switchLocalUser } from '@/lib/user-storage'
import {
  discardRecoveryCopy,
  recoveryCopiesFor,
  saveRecoveryCopy,
} from './recovery-copies'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const documentID = '33333333-3333-4333-8333-333333333333'
const copy = (record: string, source: string) => ({
  workspaceID: '44444444-4444-4444-8444-444444444444',
  documentID,
  record,
  title: 'Schema',
  source,
  savedAt: '2026-10-09T10:00:00.000Z',
})

describe('recovery copies', () => {
  beforeEach(() => switchLocalUser(alice))
  afterEach(() => {
    switchLocalUser(alice)
    for (const { record } of recoveryCopiesFor(documentID))
      discardRecoveryCopy(documentID, record)
    switchLocalUser(null)
  })

  it('keeps the unsent source of each replaced record until it is discarded', () => {
    saveRecoveryCopy(copy('r1', 'Table mine {}'))
    saveRecoveryCopy(copy('r2', 'Table later {}'))
    expect(recoveryCopiesFor(documentID).map((c) => c.source)).toEqual([
      'Table mine {}',
      'Table later {}',
    ])
    discardRecoveryCopy(documentID, 'r1')
    expect(recoveryCopiesFor(documentID).map((c) => c.record)).toEqual(['r2'])
  })

  it('saving the same record again keeps the newest source once', () => {
    saveRecoveryCopy(copy('r1', 'old'))
    saveRecoveryCopy(copy('r1', 'newer'))
    expect(recoveryCopiesFor(documentID).map((c) => c.source)).toEqual([
      'newer',
    ])
  })

  it('belongs to the person who wrote it: another account on the device sees none', () => {
    saveRecoveryCopy(copy('r1', 'Table private {}'))
    switchLocalUser(bob)
    expect(recoveryCopiesFor(documentID)).toEqual([])
    switchLocalUser(alice)
    expect(recoveryCopiesFor(documentID)).toHaveLength(1)
  })

  it('reads nothing when signed out', () => {
    saveRecoveryCopy(copy('r1', 'x'))
    switchLocalUser(null)
    expect(recoveryCopiesFor(documentID)).toEqual([])
  })
})
