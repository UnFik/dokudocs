import 'dompurify'
import mermaid from 'mermaid'

export enum MarkerSeverity {
  Hint = 1,
  Info = 2,
  Warning = 4,
  Error = 8,
}

export interface DiagnosticMarker {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  message: string
  severity: MarkerSeverity
}

export function validateDbml(content: string): DiagnosticMarker[] {
  const markers: DiagnosticMarker[] = []
  const lines = content.split('\n')

  const braceStack: { line: number; col: number; type: string }[] = []
  const declaredTables = new Map<string, { line: number; columns: Set<string> }>()
  let currentTable: { name: string; line: number; columns: Set<string> } | null = null
  let inIndexesBlock = false
  let inNoteBlock = false

  const stripInlineComments = (line: string) => {
    const idx = line.indexOf('//')
    return idx >= 0 ? line.slice(0, idx) : line
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const lineNum = i + 1
    const cleanLine = stripInlineComments(rawLine).trim()

    if (!cleanLine) continue

    for (let charIdx = 0; charIdx < cleanLine.length; charIdx++) {
      const ch = cleanLine[charIdx]
      if (ch === '{') {
        braceStack.push({ line: lineNum, col: charIdx + 1, type: '{' })
      } else if (ch === '}') {
        if (braceStack.length === 0) {
          markers.push({
            startLineNumber: lineNum,
            startColumn: charIdx + 1,
            endLineNumber: lineNum,
            endColumn: charIdx + 2,
            message: "Unexpected closing brace '}'",
            severity: MarkerSeverity.Error,
          })
        } else {
          braceStack.pop()
          if (inIndexesBlock) inIndexesBlock = false
          if (inNoteBlock) inNoteBlock = false
          if (currentTable && braceStack.length === 0) {
            currentTable = null
          }
        }
      }
    }

    const tableMatch = cleanLine.match(/^Table\s+([\w."]+)(?:\s+as\s+([\w."]+))?\s*(?:\[[^\]]*\])?\s*\{?/i)
    if (tableMatch) {
      const tableName = tableMatch[1].replace(/["']/g, '').trim().toLowerCase()
      if (declaredTables.has(tableName)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: `Duplicate table definition '${tableMatch[1]}'`,
          severity: MarkerSeverity.Error,
        })
      } else {
        const tableObj = { line: lineNum, columns: new Set<string>() }
        declaredTables.set(tableName, tableObj)
        currentTable = { name: tableName, line: lineNum, columns: tableObj.columns }
      }
      continue
    }

    if (/^Table\b/i.test(cleanLine) && !tableMatch) {
      markers.push({
        startLineNumber: lineNum,
        startColumn: 1,
        endLineNumber: lineNum,
        endColumn: rawLine.length + 1,
        message: "Invalid Table definition. Expected 'Table <name> { ... }'",
        severity: MarkerSeverity.Error,
      })
      continue
    }

    if (/^TableGroup\b/i.test(cleanLine)) {
      if (!/^TableGroup\s+([\w."]+)(?:\s+as\s+([\w."]+))?\s*(?:\[[^\]]*\])?\s*\{?/i.test(cleanLine)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Invalid TableGroup definition. Expected 'TableGroup <name> { ... }'",
          severity: MarkerSeverity.Error,
        })
      }
      continue
    }

    if (/^Enum\b/i.test(cleanLine)) {
      if (!/^Enum\s+([\w."]+)\s*\{?/i.test(cleanLine)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Invalid Enum definition. Expected 'Enum <name> { ... }'",
          severity: MarkerSeverity.Error,
        })
      }
      continue
    }

    if (/^Project\b/i.test(cleanLine)) {
      if (!/^Project\s+([\w."]+)?\s*\{?/i.test(cleanLine)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Invalid Project definition. Expected 'Project <name> { ... }'",
          severity: MarkerSeverity.Error,
        })
      }
      continue
    }

    if (/^Records\b/i.test(cleanLine)) {
      if (!/^Records\s+([\w."]+)\s*\([^)]*\)\s*\{?/i.test(cleanLine)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Invalid Records syntax. Expected 'Records <table>(col1, col2) { ... }'",
          severity: MarkerSeverity.Error,
        })
      }
      continue
    }

    if (/^Ref\b/i.test(cleanLine)) {
      const refMatch = cleanLine.match(
        /^Ref(?:\s+[\w."]+)?\s*:\s*([\w."]+)\.([\w."]+)\s*([><-][?]|\?[><-]|<>|[><-])\s*([\w."]+)\.([\w."]+)/i
      )
      const refBlockStart = /^Ref(?:\s+[\w."]+)?\s*\{/i.test(cleanLine)
      if (!refMatch && !refBlockStart) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Invalid Ref syntax. Expected 'Ref: table1.col1 > table2.col2'",
          severity: MarkerSeverity.Error,
        })
      }
      continue
    }

    if (currentTable && braceStack.length > 0) {
      if (/^indexes\s*\{/i.test(cleanLine)) {
        inIndexesBlock = true
        continue
      }
      if (/^Note\s*\{/i.test(cleanLine) || /^Note\s*:/i.test(cleanLine)) {
        inNoteBlock = true
        continue
      }
      if (inIndexesBlock || inNoteBlock) {
        continue
      }

      if (cleanLine.includes('[') && !cleanLine.includes(']')) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: rawLine.indexOf('[') + 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: "Unclosed attribute bracket '['",
          severity: MarkerSeverity.Error,
        })
      }

      const columnMatch = cleanLine.match(/^([\w."]+)\s+([\w."()]+)(?:\s*\[(.*)\])?/i)
      if (columnMatch) {
        const colName = columnMatch[1].replace(/["']/g, '').trim().toLowerCase()
        if (currentTable.columns.has(colName)) {
          markers.push({
            startLineNumber: lineNum,
            startColumn: 1,
            endLineNumber: lineNum,
            endColumn: rawLine.length + 1,
            message: `Duplicate column '${columnMatch[1]}' in table '${currentTable.name}'`,
            severity: MarkerSeverity.Warning,
          })
        } else {
          currentTable.columns.add(colName)
        }
      } else if (!/^[}{]/.test(cleanLine)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: 'Invalid column definition or missing type',
          severity: MarkerSeverity.Error,
        })
      }
    }
  }

  for (const unclosed of braceStack) {
    markers.push({
      startLineNumber: unclosed.line,
      startColumn: unclosed.col,
      endLineNumber: unclosed.line,
      endColumn: unclosed.col + 1,
      message: "Unclosed block: missing '}'",
      severity: MarkerSeverity.Error,
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const lineNum = i + 1
    const cleanLine = stripInlineComments(rawLine).trim()

    const standaloneRef = cleanLine.match(
      /Ref(?:\s+[\w."]+)?\s*:\s*([\w."]+)\.([\w."]+)\s*(?:[><-][?]|\?[><-]|<>|[><-])\s*([\w."]+)\.([\w."]+)/i
    )
    if (standaloneRef) {
      const fromTable = standaloneRef[1].replace(/["']/g, '').trim().toLowerCase()
      const fromCol = standaloneRef[2].replace(/["']/g, '').trim().toLowerCase()
      const toTable = standaloneRef[3].replace(/["']/g, '').trim().toLowerCase()
      const toCol = standaloneRef[4].replace(/["']/g, '').trim().toLowerCase()

      const fromTblObj = declaredTables.get(fromTable)
      if (!fromTblObj) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: `Referenced table '${standaloneRef[1]}' is not defined`,
          severity: MarkerSeverity.Warning,
        })
      } else if (fromTblObj.columns.size > 0 && !fromTblObj.columns.has(fromCol)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: `Column '${standaloneRef[2]}' not found in table '${standaloneRef[1]}'`,
          severity: MarkerSeverity.Warning,
        })
      }

      const toTblObj = declaredTables.get(toTable)
      if (!toTblObj) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: `Referenced table '${standaloneRef[3]}' is not defined`,
          severity: MarkerSeverity.Warning,
        })
      } else if (toTblObj.columns.size > 0 && !toTblObj.columns.has(toCol)) {
        markers.push({
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: rawLine.length + 1,
          message: `Column '${standaloneRef[4]}' not found in table '${standaloneRef[3]}'`,
          severity: MarkerSeverity.Warning,
        })
      }
    }
  }

  return markers
}

export async function validateMermaid(content: string): Promise<DiagnosticMarker[]> {
  const trimmed = content.trim()
  if (!trimmed) return []

  const markers: DiagnosticMarker[] = []

  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      suppressErrorRendering: true,
      logLevel: 'fatal',
    })
    await mermaid.parse(trimmed)
  } catch (err: any) {
    let line = 1
    const msgString = String(err?.message || err?.str || err || '')

    const isEnvError =
      msgString.includes('DOMPurify.addHook is not a function') ||
      msgString.includes('DOMPurify.sanitize is not a function') ||
      msgString.includes('document is not defined') ||
      msgString.includes('window is not defined')

    if (isEnvError) {
      return []
    }

    const lineMatch =
      msgString.match(/(?:line|Line)\s+(\d+)/) ||
      msgString.match(/on line\s*(\d+)/i) ||
      msgString.match(/:\s*(\d+):/)
    if (lineMatch) {
      line = Math.max(1, parseInt(lineMatch[1], 10))
    } else if (err?.hash?.loc?.first_line) {
      line = Math.max(1, err.hash.loc.first_line)
    } else if (err?.hash?.line) {
      line = Math.max(1, err.hash.line)
    }

    let cleanMsg = msgString
    if (cleanMsg.includes('Parse error on line')) {
      const splitLines = cleanMsg.split('\n')
      const expectLine = splitLines.find((l: string) => l.includes('Expecting')) || splitLines[0]
      cleanMsg = expectLine.trim()
    }

    const totalLines = content.split('\n').length
    if (line > totalLines) {
      line = totalLines
    }

    markers.push({
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: 1000,
      message: cleanMsg || 'Syntax error in Mermaid diagram',
      severity: MarkerSeverity.Error,
    })
  }

  return markers
}

export async function runDiagnostics(
  model: any,
  language: string,
  monacoInstance?: any
): Promise<DiagnosticMarker[]> {
  if (!model) return []
  const content = model.getValue()
  let markers: DiagnosticMarker[] = []

  if (language === 'dbml') {
    markers = validateDbml(content)
  } else if (language === 'mermaid') {
    markers = await validateMermaid(content)
  }

  const monacoMarkers = markers.map((m) => ({
    startLineNumber: m.startLineNumber,
    startColumn: m.startColumn,
    endLineNumber: m.endLineNumber,
    endColumn: m.endColumn,
    message: m.message,
    severity: m.severity,
  }))

  const mInstance =
    monacoInstance || (typeof window !== 'undefined' ? (window as any).monaco : undefined)
  if (mInstance && mInstance.editor && mInstance.editor.setModelMarkers) {
    mInstance.editor.setModelMarkers(model, language, monacoMarkers)
  }

  return markers
}
