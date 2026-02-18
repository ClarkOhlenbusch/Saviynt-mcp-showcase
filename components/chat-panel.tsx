'use client'

import React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { Send, Square, FileText, Loader2, AlertTriangle, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatMessage } from './chat-message'
import { DemoPrompts } from './demo-prompts'
import { cn } from '@/lib/utils'
import type { Artifact, McpPendingRequest, McpPendingRequestSummary } from '@/lib/mcp/types'
import type { GeminiMessageMetadata, GeminiUsageEvent } from '@/lib/gemini-usage'
import { DEMO_PROMPTS } from '@/lib/agent/prompts'
import {
  SUBMITTED_STATUS_MESSAGES,
  assessArtifactCandidate,
  buildSelectedRequestPrompts,
  extractAssistantText,
  isToolMessagePart,
  isUsageLimitError,
  parseChatErrorMessage,
  toArtifactToolTrace,
  toGeminiUsageEvent,
  type MessagePart,
} from './chat-panel/chat-panel-helpers'
import { ReviewContextBanner } from './chat-panel/review-context-banner'
import { DecisionConfirmDialog } from './chat-panel/decision-confirm-dialog'

interface ChatPanelProps {
  mcpConnected: boolean
  onArtifactGenerated: (artifact: Artifact) => void
  onOpenArtifacts: () => void
  artifactCount: number
  apiKey: string
  saviyntUsername?: string
  saviyntPassword?: string
  onOpenFaq: () => void
  onOpenStartHere: () => void
  onUsageEvent: (event: GeminiUsageEvent) => void
  selectedRequest?: McpPendingRequest | null
  setSelectedRequest?: (request: McpPendingRequest | null) => void
  redactionEnabled: boolean
  destructiveActionsEnabled: boolean
  pendingRequestsSnapshot: McpPendingRequestSummary[]
  pendingRequestsSnapshotUpdatedAt: number
}

export function ChatPanel({
  mcpConnected,
  onArtifactGenerated,
  onOpenArtifacts,
  artifactCount,
  apiKey,
  saviyntUsername,
  saviyntPassword,
  onOpenFaq,
  onOpenStartHere,
  onUsageEvent,
  selectedRequest,
  setSelectedRequest,
  redactionEnabled,
  destructiveActionsEnabled,
  pendingRequestsSnapshot,
  pendingRequestsSnapshotUpdatedAt,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const artifactMessageIdsRef = useRef(new Set<string>())
  const usageMessageIdsRef = useRef(new Set<string>())
  const [decisionDialogOpen, setDecisionDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'reject' | null>(null)



  const apiKeyRef = useRef(apiKey)
  const saviyntUsernameRef = useRef(saviyntUsername)
  const saviyntPasswordRef = useRef(saviyntPassword)
  const selectedRequestRef = useRef(selectedRequest)
  const redactionEnabledRef = useRef(redactionEnabled)
  const destructiveActionsEnabledRef = useRef(destructiveActionsEnabled)
  const pendingRequestsSnapshotRef = useRef(pendingRequestsSnapshot)
  const pendingRequestsSnapshotUpdatedAtRef = useRef(pendingRequestsSnapshotUpdatedAt)
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])
  useEffect(() => { saviyntUsernameRef.current = saviyntUsername }, [saviyntUsername])
  useEffect(() => { saviyntPasswordRef.current = saviyntPassword }, [saviyntPassword])
  useEffect(() => { selectedRequestRef.current = selectedRequest }, [selectedRequest])
  useEffect(() => { redactionEnabledRef.current = redactionEnabled }, [redactionEnabled])
  useEffect(() => { destructiveActionsEnabledRef.current = destructiveActionsEnabled }, [destructiveActionsEnabled])
  useEffect(() => { pendingRequestsSnapshotRef.current = pendingRequestsSnapshot }, [pendingRequestsSnapshot])
  useEffect(() => { pendingRequestsSnapshotUpdatedAtRef.current = pendingRequestsSnapshotUpdatedAt }, [pendingRequestsSnapshotUpdatedAt])

  const { messages, sendMessage, status, stop, error, clearError } = useChat<UIMessage<GeminiMessageMetadata>>({
    transport: React.useMemo(() => new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        apiKey: apiKeyRef.current,
        saviyntUsername: saviyntUsernameRef.current,
        saviyntPassword: saviyntPasswordRef.current,
        selectedRequest: selectedRequestRef.current,
        redactionEnabled: redactionEnabledRef.current,
        destructiveActionsEnabled: destructiveActionsEnabledRef.current,
        pendingRequestsSnapshot: pendingRequestsSnapshotRef.current,
        pendingRequestsSnapshotUpdatedAt: pendingRequestsSnapshotUpdatedAtRef.current,
      }),
    }), []),
  })

  const isStreaming = status === 'streaming'
  const isSubmitted = status === 'submitted'
  const isLoading = isStreaming || isSubmitted
  const chatErrorMessage = parseChatErrorMessage(error)
  const usageLimitExceeded = isUsageLimitError(chatErrorMessage)
  const [submittedStatusIndex, setSubmittedStatusIndex] = useState(0)

  const suggestedPrompts = React.useMemo(
    () => (selectedRequest ? buildSelectedRequestPrompts(selectedRequest) : DEMO_PROMPTS),
    [selectedRequest]
  )
  const promptTitle = selectedRequest ? 'Access Review Assistant' : 'Identity Security Agent'
  const promptDescription = selectedRequest
    ? 'Start with a focused access-review question for the active request.'
    : 'Try one of these scenarios or type your own question below.'

  useEffect(() => {
    if (!isSubmitted) {
      setSubmittedStatusIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setSubmittedStatusIndex((prev) => (prev + 1) % SUBMITTED_STATUS_MESSAGES.length)
    }, 2200)

    return () => window.clearInterval(intervalId)
  }, [isSubmitted])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  useEffect(() => {
    if (status !== 'ready' || messages.length === 0) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg.role !== 'assistant') return
    if (artifactMessageIdsRef.current.has(lastMsg.id)) return

    const text = extractAssistantText(lastMsg.parts as MessagePart[] | undefined)
    const candidate = assessArtifactCandidate(text)
    if (!candidate) return

    const toolTraces = lastMsg.parts
      .filter(isToolMessagePart)
      .map((part) => toArtifactToolTrace(part)) || []

    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: candidate.title,
      type: candidate.type,
      markdown: candidate.markdown,
      evidenceJson: toolTraces,
      createdAt: Date.now(),
    }

    onArtifactGenerated(artifact)
    artifactMessageIdsRef.current.add(lastMsg.id)
  }, [status, messages, onArtifactGenerated])

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      if (usageMessageIdsRef.current.has(message.id)) continue

      const usageEvent = toGeminiUsageEvent(message.metadata)
      if (!usageEvent) continue

      onUsageEvent(usageEvent)
      usageMessageIdsRef.current.add(message.id)
    }
  }, [messages, onUsageEvent])

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

  const handleDecisionIntent = useCallback((decision: 'approve' | 'reject') => {
    if (!selectedRequestRef.current) return
    setPendingDecision(decision)
    setDecisionDialogOpen(true)
  }, [])

  const handleDecisionDialogChange = useCallback((open: boolean) => {
    setDecisionDialogOpen(open)
    if (!open) {
      setPendingDecision(null)
    }
  }, [])

  const handleDecisionConfirm = useCallback(async () => {
    const activeRequest = selectedRequestRef.current
    if (!activeRequest || !pendingDecision) return

    setDecisionDialogOpen(false)
    const decision = pendingDecision
    setPendingDecision(null)

    const action = decision === 'approve' ? 'approve' : 'reject'
    const prompt = `Please ${action} this request for ${activeRequest.requestedfor} (Request ID: ${activeRequest.requestid || activeRequest.requestkey}).`

    clearError()
    sendMessage({ text: prompt })
  }, [pendingDecision, clearError, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(input)
    }
  }

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const hasMessages = messages.length > 0
  const lastMessage = messages[messages.length - 1]
  const isLastMessageStreaming = isStreaming && lastMessage?.role === 'assistant'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-4">
          {selectedRequest && (
            <ReviewContextBanner
              selectedRequest={selectedRequest}
              destructiveActionsEnabled={destructiveActionsEnabled}

              onDecisionIntent={handleDecisionIntent}
              onClearContext={() => setSelectedRequest?.(null)}
            />
          )}
          {!hasMessages && mcpConnected && (
            <DemoPrompts
              onSelect={handleSuggestionSelect}
              visible={!hasMessages}
              prompts={suggestedPrompts}
              title={promptTitle}
              description={promptDescription}
            />
          )}
          {!hasMessages && !mcpConnected && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex items-center justify-center mb-6">
                <img
                  src="https://saviynt.com/hubfs/raw_assets/saviynt-theme-26/169/js_client_assets/assets/saviynt-logo-DWEmNKg8.svg"
                  alt="Saviynt"
                  className="h-10 w-auto dark:invert"
                  loading="eager"
                />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Start Here</h2>
              <p className="text-sm text-muted-foreground max-w-sm text-pretty">
                Open the setup guide and follow each step to add your API key and connect MCP.
              </p>
              <Button
                size="lg"
                onClick={onOpenStartHere}
                className="mt-5 h-11 px-8 text-sm font-semibold"
              >
                <BookOpen className="h-4 w-4 mr-2" />
                Open Start Here Guide
              </Button>
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
              <span className="text-sm text-muted-foreground">
                {SUBMITTED_STATUS_MESSAGES[submittedStatusIndex]}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

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

      <DecisionConfirmDialog
        open={decisionDialogOpen}
        pendingDecision={pendingDecision}

        destructiveActionsEnabled={destructiveActionsEnabled}
        onOpenChange={handleDecisionDialogChange}
        onConfirm={() => {
          void handleDecisionConfirm()
        }}
      />
    </div>
  )
}
