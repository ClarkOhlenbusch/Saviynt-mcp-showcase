'use client'

import { useState } from 'react'
import { FileText, Download, Copy, Check, ChevronRight, X, Code } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Artifact } from '@/lib/mcp/types'
import { artifactToMarkdown, artifactToEvidenceJson } from '@/lib/artifacts'
import ReactMarkdown from 'react-markdown'

interface ArtifactPanelProps {
  artifacts: Artifact[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ArtifactPanel({ artifacts, open, onOpenChange }: ArtifactPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const selected = artifacts.find((a) => a.id === selectedId)

  if (!open) return null

  async function handleCopyMarkdown() {
    if (!selected) return
    const md = artifactToMarkdown(selected)
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownloadEvidence() {
    if (!selected) return
    const json = artifactToEvidenceJson(selected)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.title.replace(/\s+/g, '-').toLowerCase()}-evidence.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDownloadMarkdown() {
    if (!selected) return
    const md = artifactToMarkdown(selected)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.title.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const typeLabels: Record<Artifact['type'], string> = {
    'access-review': 'Access Review',
    'sod-analysis': 'SoD Analysis',
    'onboarding-plan': 'Onboarding',
    'generic': 'Report',
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-card border-l border-border z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Artifacts</h2>
          <Badge variant="secondary" className="text-[10px] h-4 bg-secondary text-secondary-foreground">
            {artifacts.length}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      {!selected ? (
        <ScrollArea className="flex-1">
          <div className="p-3 flex flex-col gap-2">
            {artifacts.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No artifacts yet</p>
                <p className="text-xs text-muted-foreground mt-1">Generated reports will appear here</p>
              </div>
            ) : (
              artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setSelectedId(artifact.id)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:bg-secondary/50 transition-colors text-left group"
                >
                  <div className="flex items-center justify-center h-9 w-9 rounded-md bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{artifact.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{typeLabels[artifact.type]}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(artifact.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} className="h-7 text-xs text-muted-foreground hover:text-foreground">
              Back
            </Button>
            <span className="text-sm font-medium text-foreground truncate">{selected.title}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <Button variant="outline" size="sm" onClick={handleDownloadMarkdown} className="h-7 text-xs bg-transparent">
              <Download className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyMarkdown} className="h-7 text-xs bg-transparent">
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadEvidence} className="h-7 text-xs bg-transparent">
              <Code className="h-3 w-3 mr-1" />
              Evidence JSON
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 prose-artifact text-sm">
              <ReactMarkdown>{artifactToMarkdown(selected)}</ReactMarkdown>
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
