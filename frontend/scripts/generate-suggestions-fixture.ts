// Writes the Yjs encoding of the suggestion fixture for the backend's projection
// test. Run it from frontend/ after changing suggestionFixture.ts:
//   bun scripts/generate-suggestions-fixture.ts
import { writeFileSync } from 'node:fs'
import { prosemirrorToYDoc } from 'y-prosemirror'
import * as Y from 'yjs'
import { suggestionFixtureDoc } from '../src/features/docs/lib/prosemirror/suggestionFixture'

const target =
  '../backend/internal/infrastructure/collaboration/yjs/testdata/suggestions_v1.b64'
const doc = prosemirrorToYDoc(suggestionFixtureDoc(), 'body')
writeFileSync(
  target,
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') + '\n'
)
process.stdout.write(`wrote ${target}\n`)
