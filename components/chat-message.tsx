'use client'

import { cn } from '@/lib/utils'
import { ToolTrace } from './tool-trace'
import { Bot, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { UIMessage } from 'ai'

interface ChatMessageProps {
  message: UIMessage
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant'

  // Extract tool invocation parts
  const toolParts = message.parts?.filter(
    (p) => p.type === 'tool-invocation'
  ) || []

  const toolTraces = toolParts.map((p) => {
    if (p.type !== 'tool-invocation') return null
    return {
      toolName: p.toolInvocation.toolName,
      args: p.toolInvocation.args as Record<string, unknown>,
      result: p.toolInvocation.state === 'output-available' ? p.toolInvocation.output : undefined,
      duration: (p.toolInvocation as Record<string, unknown>).duration as number | undefined,
      state: p.toolInvocation.state,
    }
  }).filter(Boolean) as Array<{
    toolName: string
    args?: Record<string, unknown>
    result?: unknown
    duration?: number
    state: string
  }>

  // Extract text parts
  const textContent = message.parts
    ?.filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('') || ''

  return (
    <div className={cn(
      'flex gap-3 py-4',
      isAssistant ? '' : 'flex-row-reverse'
    )}>
      <div className={cn(
        'flex items-center justify-center h-8 w-8 rounded-lg shrink-0',
        isAssistant ? 'bg-primary/10' : 'bg-secondary'
      )}>
        {isAssistant ? (
          <Bot className="h-4 w-4 text-primary" />
        ) : (
          <User className="h-4 w-4 text-foreground" />
        )}
      </div>
      <div className={cn(
        'flex flex-col gap-1 min-w-0 max-w-[85%]',
        isAssistant ? '' : 'items-end'
      )}>
        {toolTraces.length > 0 && isAssistant && (
          <ToolTrace traces={toolTraces} />
        )}
        {textContent && (
          <div className={cn(
            'rounded-xl px-4 py-3 text-sm leading-relaxed',
            isAssistant
              ? 'bg-card text-card-foreground prose-artifact'
              : 'bg-primary text-primary-foreground'
          )}>
            {isAssistant ? (
              <ReactMarkdown>{textContent}</ReactMarkdown>
            ) : (
              <p className="whitespace-pre-wrap">{textContent}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
