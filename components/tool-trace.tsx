'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface ToolTraceItem {
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  duration?: number
  state: string
}

interface ToolTraceProps {
  traces: ToolTraceItem[]
}

export function ToolTrace({ traces }: ToolTraceProps) {
  if (traces.length === 0) return null

  return (
    <div className="flex flex-col gap-1 my-2">
      {traces.map((trace, i) => (
        <ToolTraceItem key={`${trace.toolName}-${i}`} trace={trace} />
      ))}
    </div>
  )
}

function ToolTraceItem({ trace }: { trace: ToolTraceItem }) {
  const [expanded, setExpanded] = useState(false)
  const isComplete = trace.state === 'output-available'
  const isError = trace.state === 'output-error'
  const isLoading = trace.state === 'input-streaming' || trace.state === 'input-available'

  return (
    <div className="rounded-md border border-border bg-card/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-mono text-xs text-foreground truncate">{trace.toolName}</span>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {trace.duration != null && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {trace.duration}ms
            </span>
          )}
          {isComplete && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-accent/10 text-accent border-0">
              Success
            </Badge>
          )}
          {isError && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
              Error
            </Badge>
          )}
          {isLoading && (
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] text-muted-foreground">Running</span>
            </div>
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border">
          {trace.args && Object.keys(trace.args).length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Arguments</p>
              <pre className="text-[11px] text-secondary-foreground bg-secondary/50 rounded p-2 overflow-x-auto font-mono">
                {JSON.stringify(trace.args, null, 2)}
              </pre>
            </div>
          )}
          {trace.result != null && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Response Preview</p>
              <pre className={cn(
                "text-[11px] rounded p-2 overflow-x-auto font-mono max-h-40 overflow-y-auto",
                isError ? "bg-destructive/10 text-destructive" : "bg-secondary/50 text-secondary-foreground"
              )}>
                {typeof trace.result === 'string' ? trace.result : JSON.stringify(trace.result, null, 2)?.slice(0, 500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
