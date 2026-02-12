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

    const text = lastMsg.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('') || ''

    // Detect report-like content
    const isReport = (
      text.includes('## Executive Summary') ||
      text.includes('## Findings') ||
      text.includes('## Scope') ||
      text.includes('## Recommendations') ||
      text.includes('Access Review Brief') ||
      text.includes('SoD Conflict') ||
      text.includes('Onboarding Plan') ||
      text.includes('Provisioning Plan')
    )

    if (isReport && text.length > 300) {
      let type: Artifact['type'] = 'generic'
      let title = 'Generated Report'
      if (text.includes('Access Review')) {
        type = 'access-review'
        title = 'Access Review Brief'
      } else if (text.includes('SoD') || text.includes('Separation of Duties')) {
        type = 'sod-analysis'
        title = 'SoD Conflict Analysis'
      } else if (text.includes('Onboarding') || text.includes('Provisioning')) {
        type = 'onboarding-plan'
        title = 'Onboarding & Provisioning Plan'
      }

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
            responsePreview: tp.state === 'output-available'
              ? JSON.stringify(tp.output)?.slice(0, 300) || ''
              : '',
            duration: 0,
            success: tp.state === 'output-available',
            timestamp: Date.now(),
          }
        }).filter(Boolean) || []

      const artifact: Artifact = {
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        type,
        markdown: text,
        evidenceJson: toolTraces as Artifact['evidenceJson'],
        createdAt: Date.now(),
      }

      onArtifactGenerated(artifact)
    }
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
