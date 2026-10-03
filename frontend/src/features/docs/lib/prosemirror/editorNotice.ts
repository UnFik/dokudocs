/**
 * A message written for the person editing, such as "this selection cannot be
 * deleted in one step". Every other error the editor raises is internal: it goes
 * to the log, never to the screen.
 */
export class EditorNotice extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorNotice'
  }
}
