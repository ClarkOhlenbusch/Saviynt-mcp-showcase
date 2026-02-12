'use client'

import React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Send, Square, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatMessage } from './chat-message'
import { DemoPrompts } from './demo-prompts'
import type { Artifact } from '@/lib/mcp/types'

interface ChatPanelProps {
  mcpConnected: boolean
  onArtifactGenerated: (artifact: Artifact) => void
  onOpenArtifacts: () => void
  artifactCount: number
  apiKey: string
}

const THINKING_PHRASES = [
  'Establishing connection... ',
  'Connecting to Saviynt... ',
  'Discovering security tools...',
  'Planning approach...',
  'Analyzing request...',
  'Processing metadata...',
  'Preparing data scan...',
]

const TOOL_PHRASES: Record<string, string[]> = {
  'get_users': [
    'Scanning user directory...',
    'Retrieving identity profiles...',
    'Checking account status...',
    'Loading user attributes...',
  ],
  'get_complete_access_path': [
    'Tracing permission lineage...',
    'Analyzing role hierarchy...',
    'Mapping entitlement paths...',
    'Verifying access inheritance...',
    'Checking separation of duties...',
    'Reviewing access certification history...',
  ],
  'get_identity': [
    'Locating identity record...',
    'Retrieving profile details...',
    'Checking lifecycle state...',
    'Loading manager relationships...',
    'Analyzing birthright entitlements...',
  ],
  'run_access_review': [
    'Initiating certification campaign...',
    'Identifying reviewers...',
    'Generating review items...',
    'Calculating progress metrics...',
    'Evaluating risk factors...',
  ],
  'check_sod_violation': [
    'Analyzing conflicting permissions...',
    'Checking rule matrix...',
    'Identifying toxic combinations...',
    'Validating control effectiveness...',
    'Reviewing mitigation logs...',
  ],
  'get_roles': [
    'Fetching role definitions...',
    'Analyzing role membership...',
    'Checking role owners...',
    'Mapping role entitlements...',
  ],
  'get_entitlements': [
    'Retrieving entitlement catalog...',
    'Checking entitlement owners...',
    'Analyzing access risk levels...',
  ],
  'run_search': [
    'Executing global query...',
    'Filtering results...',
    'Indexing findings...',
  ],
  'default': [
    'Executing operation...',
    'Communicating with Saviynt server...',
    'Processing security request...',
    'Validating inputs...',
  ]
}

function formatToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getToolDetails(args: any): string {
  if (!args || typeof args !== 'object') return ''

  // Lists of keys to prioritize for display
  const priorityKeys = ['query', 'path', 'file', 'url', 'command', 'name', 'key']

  for (const key of priorityKeys) {
    if (key in args && typeof args[key] === 'string') {
      const val = args[key]
      if (val.length > 30) return `: "${val.slice(0, 30)}..."`
      return `: "${val}"`
    }
  }

  // Fallback to first string value
  const values = Object.values(args)
  const firstString = values.find(v => typeof v === 'string') as string | undefined
  if (firstString) {
    if (firstString.length > 20) return ` "${firstString.slice(0, 20)}..."`
    return ` "${firstString}"`
  }

  return ''
}

const FALLBACK_PHRASES = [
  'Analyzing security context...',
  'Preparing response brief...',
  'Formatting results...',
  'Reviewing collected data...',
]

function getStreamingStatus(messages: any[], index: number): string | null {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  if (last.role !== 'assistant') return null

  const parts = last.parts || []
  const toolInvocations = last.toolInvocations || []

  // Normalize all tool invocations from various possible AI SDK structures
  const allTools = [
    ...toolInvocations,
    ...(parts.filter((p: any) => p.type === 'tool-invocation' || p.type === 'tool-call').map((p: any) => p.toolInvocation || p))
  ].filter(ti => ti && (ti.toolName || ti.name))

  const total = allTools.length
  const completed = allTools.filter((ti: any) =>
    ti.state === 'result' ||
    ti.state === 'output-available' ||
    ti.state === 'output-error' ||
    ti.result ||
    ti.output
  ).length

  // Find the most recent in-progress tool
  const activeTool = [...allTools].reverse().find((ti: any) =>
    ti.state === 'call' || ti.state === 'partial-call' || ti.state === 'input-streaming' || !ti.result
  )

  if (activeTool) {
    const rawName = activeTool.toolName || activeTool.name || ''
    const name = formatToolName(rawName)
    const details = getToolDetails(activeTool.args) || getToolDetails(activeTool.input)

    // Get rotating phrase
    const phrases = TOOL_PHRASES[rawName] || TOOL_PHRASES['default']
    const phrase = phrases[index % phrases.length]

    if (total > 1) {
      return `[${name.toUpperCase()}] ${phrase}${details} (${completed}/${total})`
    }
    return `[${name.toUpperCase()}] ${phrase}${details}`
  }

  // If no tools are currently running but some were called, we are summarizing or synthesizing
  if (total > 0 && completed === total) {
    const lastTool = allTools[allTools.length - 1]
    const name = formatToolName(lastTool?.toolName || lastTool?.name || '').toUpperCase()

    if (total > 1) {
      return `SYNTHESIZING security insights from ${total} sources...`
    }
    return `FINALIZING analysis for ${name}...`
  }

  // Fallback while waiting for specific parts
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'reasoning') return 'Reasoning...'
  if (lastPart?.type === 'text' && lastPart.text) return null // Model is writing final answer

  return FALLBACK_PHRASES[index % FALLBACK_PHRASES.length]
}

export function ChatPanel({ mcpConnected, onArtifactGenerated, onOpenArtifacts, artifactCount, apiKey }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Use a ref so the transport body function always reads the latest key
  const apiKeyRef = useRef(apiKey)
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])

  const { messages, sendMessage, status, stop } = useChat({
    transport: React.useMemo(() => new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({ apiKey: apiKeyRef.current }),
    }), []),
  })

  const isStreaming = status === 'streaming'
  const isSubmitted = status === 'submitted'
  const isLoading = isStreaming || isSubmitted

  // Rotate through thinking/status phrases
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0)
  useEffect(() => {
    if (!isLoading) { setLoadingPhaseIndex(0); return }
    const interval = setInterval(() => {
      setLoadingPhaseIndex((i) => i + 1)
    }, 2500)
    return () => clearInterval(interval)
  }, [isLoading])

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
        ?.filter((p) => p.type === 'tool-invocation')
        .map((p) => {
          const toolPart = p as any
          const toolInvocation = toolPart.toolInvocation
          if (!toolInvocation) return null

          return {
            id: toolInvocation.toolCallId,
            toolName: toolInvocation.toolName,
            args: toolInvocation.args,
            argsRedacted: toolInvocation.args,
            responsePreview: toolInvocation.state === 'output-available'
              ? JSON.stringify(toolInvocation.output)?.slice(0, 300) || ''
              : '',
            duration: 0,
            success: toolInvocation.state === 'output-available',
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
    sendMessage({ text: text.trim() })
    setInput('')
  }, [sendMessage, isLoading])

  const handleSuggestionSelect = useCallback((prompt: string) => {
    sendMessage({ text: prompt })
  }, [sendMessage])

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
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {(isSubmitted || (isStreaming && getStreamingStatus(messages, loadingPhaseIndex) !== null)) && (
            <div className="flex items-center gap-2 py-4">
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              </div>
              <span className="text-sm text-muted-foreground">
                {isSubmitted
                  ? THINKING_PHRASES[loadingPhaseIndex % THINKING_PHRASES.length]
                  : getStreamingStatus(messages, loadingPhaseIndex)}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
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
