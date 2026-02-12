'use client'

import React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Send, Square, FileText, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatMessage } from './chat-message'
import { DemoPrompts } from './demo-prompts'
import { cn } from '@/lib/utils'
import type { Artifact } from '@/lib/mcp/types'

interface ChatPanelProps {
  mcpConnected: boolean
  onArtifactGenerated: (artifact: Artifact) => void
  onOpenArtifacts: () => void
  artifactCount: number
  apiKey: string
  onOpenFaq: () => void
}

const USAGE_LIMIT_PATTERNS = [
  /quota/i,
  /rate limit/i,
  /too many requests/i,
  /resource_exhausted/i,
  /limit exceeded/i,
  /\b429\b/i,
]

const MIN_SIGNIFICANT_DELIVERABLE_LENGTH = 320

const DELIVERABLE_KEYWORD_PATTERNS = [
  /\baccess review brief\b/i,
  /\bsod conflict/i,
  /\bseparation of duties\b/i,
  /\bonboarding (?:and )?provisioning plan\b/i,
  /\bprovisioning plan\b/i,
]

const DELIVERABLE_SECTION_PATTERNS = [
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?executive summary(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?scope(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?methodology(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?findings(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?recommendations(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?conflicts identified(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?remediation plan(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?baseline access bundle(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?approvals required(?:\*\*)?\b/i,
]

type MessagePart = {
  type: string
  [key: string]: unknown
}

type ArtifactCandidate = {
  type: Artifact['type']
  title: string
  markdown: string
}

function parseChatErrorMessage(error: Error | undefined): string {
  if (!error) return ''
  const rawMessage = (error.message || String(error)).trim()
  if (!rawMessage) return 'The request failed. Please try again.'

  const jsonStart = rawMessage.indexOf('{')
  const jsonEnd = rawMessage.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: string
        message?: string
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
    } catch {
      // Fallback to raw message.
    }
  }

  return rawMessage
}

function isUsageLimitError(message: string): boolean {
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

function extractAssistantText(parts: MessagePart[] | undefined): string {
  if (!Array.isArray(parts) || parts.length === 0) return ''
  return parts
    .filter((part): part is MessagePart & { type: 'text'; text: string } =>
      part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text.trimEnd())
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim()
}

function toPreview(value: unknown, maxLength = 300): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.slice(0, maxLength)
  try {
    return JSON.stringify(value).slice(0, maxLength)
  } catch {
    return String(value).slice(0, maxLength)
  }
}

function inferArtifactType(text: string): Artifact['type'] {
  if (/sod|separation of duties/i.test(text)) return 'sod-analysis'
  if (/onboarding|provisioning/i.test(text)) return 'onboarding-plan'
  if (/access review/i.test(text)) return 'access-review'
  return 'generic'
}

function inferArtifactTitle(text: string, type: Artifact['type']): string {
  const titleLine = text.match(/(?:^|\n)\s{0,3}#{1,2}\s+(.+?)\s*(?=\n|$)/i)?.[1]?.trim()
  if (
    titleLine &&
    !/^executive summary$/i.test(titleLine) &&
    !/^findings$/i.test(titleLine) &&
    !/^scope$/i.test(titleLine)
  ) {
    return titleLine
  }

  if (type === 'access-review') return 'Access Review Brief'
  if (type === 'sod-analysis') return 'SoD Conflict Analysis'
  if (type === 'onboarding-plan') return 'Onboarding & Provisioning Plan'
  return 'Generated Report'
}

function assessArtifactCandidate(text: string): ArtifactCandidate | null {
  const normalized = text.trim()
  if (normalized.length < MIN_SIGNIFICANT_DELIVERABLE_LENGTH) return null

  const hasKeyword = DELIVERABLE_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized))
  const sectionMatches = DELIVERABLE_SECTION_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
    0
  )
  const hasTable = /\n\|.+\|/.test(normalized) && /\n\|[:\-\s|]+\|/.test(normalized)

  const significanceScore = (hasKeyword ? 2 : 0) + Math.min(sectionMatches, 4) + (hasTable ? 1 : 0)
  if (significanceScore < 3 && !(hasKeyword && normalized.length >= 500)) return null

  const type = inferArtifactType(normalized)
  const title = inferArtifactTitle(normalized, type)

  return {
    type,
    title,
    markdown: normalized,
  }
}

export function ChatPanel({
  mcpConnected,
  onArtifactGenerated,
  onOpenArtifacts,
  artifactCount,
  apiKey,
  onOpenFaq,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const artifactMessageIdsRef = useRef(new Set<string>())

  // Use a ref so the transport body function always reads the latest key
  const apiKeyRef = useRef(apiKey)
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport: React.useMemo(() => new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({ apiKey: apiKeyRef.current }),
    }), []),
  })

  const isStreaming = status === 'streaming'
  const isSubmitted = status === 'submitted'
  const isLoading = isStreaming || isSubmitted
  const chatErrorMessage = parseChatErrorMessage(error)
  const usageLimitExceeded = isUsageLimitError(chatErrorMessage)

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  // Check for artifact-worthy content in the latest message
  useEffect(() => {
    if (status !== 'ready' || messages.length === 0) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg.role !== 'assistant') return
    if (artifactMessageIdsRef.current.has(lastMsg.id)) return

    const text = extractAssistantText(lastMsg.parts as MessagePart[] | undefined)
    const candidate = assessArtifactCandidate(text)
    if (!candidate) return

    const toolTraces = lastMsg.parts
      ?.filter((p) => p.type.startsWith('tool-') || p.type === 'dynamic-tool')
      .map((p) => {
        const tp = p as any
        const toolName = tp.type === 'dynamic-tool' ? tp.toolName : tp.type.split('-').slice(1).join('-')

        return {
          id: tp.toolCallId,
          toolName,
          args: tp.input,
          argsRedacted: tp.input,
          responsePreview:
            tp.state === 'output-available'
              ? toPreview(tp.output)
              : tp.state === 'output-error'
                ? toPreview(tp.errorText)
                : '',
          duration: typeof tp.duration === 'number' ? tp.duration : 0,
          success: tp.state === 'output-available',
          timestamp: Date.now(),
        }
      })
      .filter(Boolean) || []

    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: candidate.title,
      type: candidate.type,
      markdown: candidate.markdown,
      evidenceJson: toolTraces as Artifact['evidenceJson'],
      createdAt: Date.now(),
    }

    onArtifactGenerated(artifact)
    artifactMessageIdsRef.current.add(lastMsg.id)
  }, [status, messages, onArtifactGenerated])

  const handleSubmit = useCallback((text: string) => {
    if (!text.trim() || isLoading) return
    clearError()
    sendMessage({ text: text.trim() })
    setInput('')
  }, [sendMessage, isLoading, clearError])

  const handleSuggestionSelect = useCallback((prompt: string) => {
    clearError()
    sendMessage({ text: prompt })
  }, [sendMessage, clearError])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(input)
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const hasMessages = messages.length > 0

  // Determine if the last message is currently being streamed
  const lastMessage = messages[messages.length - 1]
  const isLastMessageStreaming = isStreaming && lastMessage?.role === 'assistant'

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-4">
          {!hasMessages && mcpConnected && (
            <DemoPrompts onSelect={handleSuggestionSelect} visible={!hasMessages} />
          )}
          {!hasMessages && !mcpConnected && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-4">
                <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Saviynt MCP Agent</h2>
              <p className="text-sm text-muted-foreground max-w-sm text-pretty">
                Connect to an MCP server to get started. Click <strong className="text-foreground">Connect MCP</strong> in the top bar and paste your MCP configuration JSON.
              </p>
            </div>
          )}
          {messages.map((message, idx) => (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isLastMessageStreaming && idx === messages.length - 1}
            />
          ))}
          {isSubmitted && (
            <div className="flex items-center gap-2 py-4">
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              </div>
              <span className="text-sm text-muted-foreground">Connecting...</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {chatErrorMessage && (
            <div className={cn(
              'mb-3 rounded-lg border p-3',
              usageLimitExceeded
                ? 'border-destructive/40 bg-destructive/[0.06]'
                : 'border-amber-500/40 bg-amber-500/[0.08]'
            )}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  usageLimitExceeded ? 'text-destructive' : 'text-amber-500'
                )} />
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'text-xs font-semibold',
                    usageLimitExceeded ? 'text-destructive' : 'text-amber-600'
                  )}>
                    {usageLimitExceeded ? 'Usage Limit Reached' : 'Request Failed'}
                  </p>
                  <p className={cn(
                    'mt-1 text-xs',
                    usageLimitExceeded ? 'text-destructive/90' : 'text-amber-700'
                  )}>
                    {usageLimitExceeded
                      ? 'This API key hit a rate limit or usage quota. Open FAQ for limits and next-step fixes.'
                      : chatErrorMessage}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {usageLimitExceeded && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenFaq}
                      className="h-7 border-destructive/40 bg-transparent px-2.5 text-[10px] text-destructive hover:text-destructive"
                    >
                      Open FAQ
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearError}
                    className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mcpConnected ? 'Ask about identities, access reviews, SoD conflicts...' : 'Connect to MCP first...'}
                className="w-full resize-none rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-colors min-h-[44px] max-h-[160px]"
                rows={1}
                disabled={isLoading || !mcpConnected}
              />
            </div>
            <div className="flex items-center gap-1.5 pb-0.5">
              {artifactCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenArtifacts}
                  className="h-9 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {artifactCount}
                </Button>
              )}
              {isLoading ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={stop}
                  className="h-9 w-9 border-border text-muted-foreground hover:text-foreground bg-transparent"
                  aria-label="Stop generating"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => handleSubmit(input)}
                  disabled={!input.trim() || !mcpConnected}
                  className="h-9 w-9 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                  aria-label="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            Agent responses are based on real MCP tool outputs. Sensitive data is redacted by default.
          </p>
        </div>
      </div>
    </div>
  )
}
