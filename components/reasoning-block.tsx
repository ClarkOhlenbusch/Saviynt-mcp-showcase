'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReasoningBlockProps {
  reasoning: string
  isStreaming: boolean
}

export function ReasoningBlock({ reasoning, isStreaming }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  // Track elapsed time while streaming
  useEffect(() => {
    if (!isStreaming) return
    startRef.current = Date.now()
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isStreaming])

  // Auto-expand while streaming, collapse when done
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true)
    } else {
      setExpanded(false)
    }
  }, [isStreaming])

  const label = isStreaming
    ? `Thinking${elapsed > 0 ? ` (${elapsed}s)` : ''}...`
    : `Thought for ${Math.max(elapsed, 1)}s`

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Brain className={cn('h-3 w-3 shrink-0', isStreaming && 'animate-pulse text-primary')} />
        <span className={cn(isStreaming && 'text-primary')}>{label}</span>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          expanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="pl-[26px] pt-1 pb-2">
          <p className="text-xs text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
            {reasoning}
            {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-primary/50 animate-pulse ml-0.5 align-text-bottom rounded-sm" />}
          </p>
        </div>
      </div>
    </div>
  )
}
