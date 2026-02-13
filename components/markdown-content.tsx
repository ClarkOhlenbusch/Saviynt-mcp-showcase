'use client'

import type { ReactNode } from 'react'
import { isValidElement } from 'react'
import ReactMarkdown from 'react-markdown'

interface MarkdownContentProps {
  content: string
}

interface ParsedTable {
  leadText: string | null
  headers: string[]
  rows: string[][]
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => {
          const rawText = getPlainText(children)
          if (rawText) {
            const parsedTable = parsePipeTable(rawText)
            if (parsedTable) {
              return (
                <div className="mb-3">
                  {parsedTable.leadText && (
                    <p className="mb-2">{parsedTable.leadText}</p>
                  )}
                  <div className="overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          {parsedTable.headers.map((header, idx) => (
                            <th key={`${header}-${idx}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedTable.rows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {row.map((cell, cellIndex) => (
                              <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            }
          }

          return <p>{children}</p>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function getPlainText(children: ReactNode): string | null {
  const result = flattenText(children)
  if (result == null) return null
  return result.trim().length > 0 ? result : null
}

function flattenText(node: ReactNode): string | null {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    let out = ''
    for (const child of node) {
      const piece = flattenText(child)
      if (piece == null) return null
      out += piece
    }
    return out
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenText(node.props.children)
  }
  return null
}

function parsePipeTable(rawText: string): ParsedTable | null {
  const normalized = rawText.replace(/\r\n/g, '\n').trim()
  if (!normalized.includes('|')) return null
  if (!/[:-]{3,}/.test(normalized)) return null

  let lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  // Some model outputs collapse markdown table rows into a single line with "| |" boundaries.
  // Expand those row boundaries before parsing.
  if (lines.length < 3 && normalized.includes('| |')) {
    const expanded = normalized
      .replace(/\s+\|\s+\|(?=\s*[:A-Za-z0-9(])/g, '|\n|')
      .replace(/\|\s+\|/g, '|\n|')

    lines = expanded
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  if (lines.length < 3) return null

  const firstTableLine = lines.findIndex((line) => line.startsWith('|'))
  if (firstTableLine < 0) return null

  const leadText = firstTableLine > 0 ? lines.slice(0, firstTableLine).join('\n').trim() : null
  const tableLines = lines.slice(firstTableLine)

  if (tableLines.length < 3) return null

  const headers = splitTableRow(tableLines[0])
  const delimiter = splitTableRow(tableLines[1])
  if (headers.length === 0 || !isDelimiterRow(delimiter, headers.length)) return null

  const bodyLines = tableLines.slice(2)
  // If non-table lines follow, skip custom parsing so we don't drop trailing content.
  if (bodyLines.some((line) => !line.startsWith('|'))) return null

  const rowLines = bodyLines
  if (rowLines.length === 0) return null

  const rows = rowLines.map((line) => normalizeRow(splitTableRow(line), headers.length))
  return { leadText, headers, rows }
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function normalizeRow(row: string[], targetLength: number): string[] {
  if (row.length === targetLength) return row
  if (row.length > targetLength) return row.slice(0, targetLength)

  const next = [...row]
  while (next.length < targetLength) next.push('')
  return next
}

function isDelimiterRow(cells: string[], expectedColumns: number): boolean {
  if (cells.length < expectedColumns) return false
  const delimiterPattern = /^:?-{3,}:?$/
  return cells.slice(0, expectedColumns).every((cell) => delimiterPattern.test(cell))
}
