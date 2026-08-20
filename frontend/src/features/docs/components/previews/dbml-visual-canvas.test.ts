import { describe, expect, it } from 'vitest'
import {
  getDefaultEdgeJoints,
  getGhostJointCandidates,
  type JointPoint,
} from './dbml-visual-canvas'

describe('DBML edge joints', () => {
  it('places five default joints and one ghost between every adjacent pair', () => {
    const path: JointPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 120 },
      { x: 100, y: 120 },
    ]
    const defaultJoints = getDefaultEdgeJoints(path)
    const joints = [path[0], ...defaultJoints, path[path.length - 1]]

    expect(joints).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 15, axis: 'x' },
      { x: 40, y: 70, axis: 'x' },
      { x: 45, y: 120, axis: 'y' },
      { x: 100, y: 120 },
    ])
    expect(getGhostJointCandidates(path, joints)).toEqual([
      { x: 28, y: 0, axis: 'y', insertIndex: 0 },
      { x: 40, y: 43, axis: 'x', insertIndex: 1 },
      { x: 40, y: 98, axis: 'x', insertIndex: 2 },
      { x: 73, y: 120, axis: 'y', insertIndex: 3 },
    ])
  })
})
