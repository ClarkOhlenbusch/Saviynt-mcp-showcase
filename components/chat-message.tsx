'use client'

import { cn } from '@/lib/utils'
import { ToolTrace } from './tool-trace'
import { ReasoningBlock } from './reasoning-block'
import { MarkdownContent } from './markdown-content'
import { Bot, User } from 'lucide-react'
import type { UIMessage } from 'ai'

interface ChatMessageProps {
  message: UIMessage
  isStreaming?: boolean
}

/** Check if a part is a tool invocation (static tool-* or dynamic-tool) */
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

/** Extract tool name from a tool part */
function getToolName(part: any): string {
  if (part.type === 'dynamic-tool') return part.toolName
  // Static tool: type is 'tool-<name>'
  return part.type.split('-').slice(1).join('-')
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant'
  const parts = message.parts || []

  // Check if the message has any visible content
  const hasContent = parts.some(
    (p) =>
      p.type === 'text' ||
      p.type === 'reasoning' ||
      isToolPart(p)
  )

  // Don't hide streaming messages — show avatar with loading state
  if (isAssistant && !hasContent && !isStreaming) {
    return null
  }

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
        'flex flex-col gap-1 min-w-0',
        isAssistant ? 'w-full max-w-[85%]' : 'max-w-[85%] items-end'
      )}>
        {isAssistant ? (
          <AssistantParts parts={parts} isStreaming={isStreaming} />
        ) : (
          <UserContent parts={parts} />
        )}
      </div>
    </div>
  )
}

function AssistantParts({ parts, isStreaming }: { parts: UIMessage['parts']; isStreaming: boolean }) {
  // Track the index of the last reasoning part to detect if it's still streaming
  let lastReasoningIdx = -1
  for (let j = parts.length - 1; j >= 0; j--) {
    if (parts[j].type === 'reasoning') { lastReasoningIdx = j; break }
  }

  const firstToolIdx = parts.findIndex(isToolPart)
  const groupedToolTraces = parts
    .filter(isToolPart)
    .map((part) => {
      const p = part as any
      return {
        toolCallId: p.toolCallId as string | undefined,
        toolName: getToolName(p),
        args: p.input as Record<string, unknown> | undefined,
        result: p.state === 'output-available'
          ? p.output
          : p.state === 'output-error'
            ? p.errorText
            : undefined,
        duration: p.duration as number | undefined,
        state: p.state as string,
      }
    })

  const stepStartIndices = parts
    .map((part, idx) => (part.type === 'step-start' ? idx : -1))
    .filter((idx) => idx >= 0)

  const isVisibleBetweenSteps = (part: UIMessage['parts'][number], index: number): boolean => {
    if (isToolPart(part)) return index === firstToolIdx
    if (part.type === 'text') {
      return Boolean((part as { type: 'text'; text: string }).text)
    }
    if (part.type === 'reasoning') {
      const reasoningPart = part as { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
      return Boolean(reasoningPart.text?.trim()) || (
        isStreaming &&
        index === lastReasoningIdx &&
        reasoningPart.state !== 'done'
      )
    }
    return false
  }

  const visibleStepStartIndices = stepStartIndices.filter((index) => {
    if (index === 0) return false
    const nextStepIndex = stepStartIndices.find((candidate) => candidate > index) ?? parts.length
    for (let k = index + 1; k < nextStepIndex; k++) {
      if (isVisibleBetweenSteps(parts[k], k)) return true
    }
    return false
  })

  const visibleStepNumberByIndex = new Map<number, number>()
  visibleStepStartIndices.forEach((index, visibleOrder) => {
    visibleStepNumberByIndex.set(index, visibleOrder + 1)
  })

  return (
    <>
      {parts.map((part, i) => {
        // Tool parts: type starts with 'tool-' or is 'dynamic-tool'
        if (isToolPart(part)) {
          if (i !== firstToolIdx) return null
          return <ToolTrace key={`tool-group-${i}`} traces={groupedToolTraces} />
        }

        switch (part.type) {
          case 'reasoning': {
            const reasoningPart = part as { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
            const isReasoningStreaming = reasoningPart.state === 'streaming' || (isStreaming && i === lastReasoningIdx && reasoningPart.state !== 'done')
            return (
              <ReasoningBlock
                key={`reasoning-${i}`}
                reasoning={reasoningPart.text}
                isStreaming={isReasoningStreaming}
              />
            )
          }

          case 'step-start': {
            const stepNumber = visibleStepNumberByIndex.get(i)
            if (!stepNumber) return null
            return (
              <div key={`step-${i}`} className="flex items-center gap-2 my-1.5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground font-medium">Step {stepNumber}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )
          }

          case 'text': {
            const textPart = part as { type: 'text'; text: string }
            if (!textPart.text) return null
            return (
              <div
                key={`text-${i}`}
                className="rounded-xl px-4 py-3 text-sm leading-relaxed bg-card text-card-foreground prose-artifact"
              >
                <MarkdownContent content={textPart.text} />
              </div>
            )
          }

          default:
            return null
        }
      })}
    </>
  )
}

function UserContent({ parts }: { parts: UIMessage['parts'] }) {
  const textContent = parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('')

  if (!textContent) return null

  return (
    <div className="rounded-xl px-4 py-3 text-sm leading-relaxed bg-primary text-primary-foreground">
      <p className="whitespace-pre-wrap">{textContent}</p>
    </div>
  )
}
