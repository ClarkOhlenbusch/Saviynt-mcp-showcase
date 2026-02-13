'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Settings, Zap, ZapOff, FileText, Key, HelpCircle, Github, BookOpen, Plus, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { StatusBar } from '@/components/status-bar'
import { ChatPanel } from '@/components/chat-panel'
import { SettingsModal } from '@/components/settings-modal'
import { ApiKeyDialog } from '@/components/api-key-dialog'
import { ArtifactPanel } from '@/components/artifact-panel'
import { FAQDialog } from '@/components/faq-dialog'
import { QuickStartGuideDialog } from '@/components/quick-start-guide-dialog'
import { McpConfigDialog, MCP_CONFIG_STORAGE_KEY, parseMcpConfig } from '@/components/mcp-config-dialog'
import type { McpConnectionStatus, McpToolSchema, Artifact } from '@/lib/mcp/types'
import { createGeminiUsageSnapshot, type GeminiUsageEvent } from '@/lib/gemini-usage'

const GEMINI_USAGE_STORAGE_KEY = 'gemini_usage_events_v1'
const USAGE_EVENT_RETENTION_MS = 48 * 60 * 60 * 1000

function normalizeUsageEvent(value: unknown): GeminiUsageEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const event = value as Record<string, unknown>
  const inputTokens = typeof event.inputTokens === 'number' ? Math.max(0, Math.floor(event.inputTokens)) : 0
  const outputTokens = typeof event.outputTokens === 'number' ? Math.max(0, Math.floor(event.outputTokens)) : 0
  const totalTokensRaw = typeof event.totalTokens === 'number' ? Math.max(0, Math.floor(event.totalTokens)) : inputTokens + outputTokens
  const timestamp = typeof event.timestamp === 'number' ? Math.max(0, Math.floor(event.timestamp)) : 0

  if (!Number.isFinite(totalTokensRaw) || !Number.isFinite(timestamp) || timestamp <= 0) return null

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokensRaw,
    timestamp,
  }
}

export default function Page() {
  // MCP state
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>({
    connected: false,
    serverUrl: '',
    toolCount: 0,
  })
  const [tools, setTools] = useState<McpToolSchema[]>([])
  const [connecting, setConnecting] = useState(false)
  const [refreshingTools, setRefreshingTools] = useState(false)

  // UI state
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [chatSessionKey, setChatSessionKey] = useState(0)

  // Security settings
  const [redactionEnabled, setRedactionEnabled] = useState(true)
  const [destructiveActionsEnabled, setDestructiveActionsEnabled] = useState(false)

  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // API Key state
  const [apiKey, setApiKey] = useState('')
  const [geminiUsageEvents, setGeminiUsageEvents] = useState<GeminiUsageEvent[]>([])
  const [usageClock, setUsageClock] = useState(() => Date.now())

  const geminiUsageSnapshot = useMemo(
    () => createGeminiUsageSnapshot(geminiUsageEvents, usageClock),
    [geminiUsageEvents, usageClock],
  )

  // Load API key from local storage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key')
    if (savedKey) {
      setApiKey(savedKey)
    }
  }, [])

  // Load persisted token usage events
  useEffect(() => {
    const raw = localStorage.getItem(GEMINI_USAGE_STORAGE_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return

      const cutoff = Date.now() - USAGE_EVENT_RETENTION_MS
      const events = parsed
        .map((item) => normalizeUsageEvent(item))
        .filter((item): item is GeminiUsageEvent => item !== null && item.timestamp >= cutoff)

      setGeminiUsageEvents(events)
    } catch {
      // Ignore malformed persisted data.
    }
  }, [])

  // Persist usage events locally
  useEffect(() => {
    localStorage.setItem(GEMINI_USAGE_STORAGE_KEY, JSON.stringify(geminiUsageEvents))
  }, [geminiUsageEvents])

  // Keep minute-based usage calculations current
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setUsageClock(Date.now())
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [])

  // Auto-reconnect MCP from cached config on mount
  useEffect(() => {
    const saved = localStorage.getItem(MCP_CONFIG_STORAGE_KEY)
    if (!saved) return
    const result = parseMcpConfig(saved)
    if (result) {
      handleConnect(result.serverUrl, result.authHeader)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleApiKeyChange = (key: string) => {
    setApiKey(key)
    localStorage.setItem('gemini_api_key', key)
  }

  async function handleConnect(serverUrl: string, authHeader: string) {
    setConnecting(true)
    try {
      const res = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, authHeader }),
      })
      const status: McpConnectionStatus = await res.json()
      setMcpStatus(status)

      if (status.connected) {
        const toolsRes = await fetch('/api/mcp/tools')
        const data = await toolsRes.json()
        setTools(data.tools || [])
        setConfigDialogOpen(false)
      }
    } catch {
      setMcpStatus((prev) => ({ ...prev, connected: false, error: 'Connection failed' }))
    } finally {
      setConnecting(false)
    }
  }

  async function handleRefreshTools() {
    setRefreshingTools(true)
    try {
      const res = await fetch('/api/mcp/tools?refresh=true')
      const data = await res.json()
      setTools(data.tools || [])
      setMcpStatus((prev) => ({ ...prev, toolCount: data.tools?.length || 0 }))
    } catch {
      // ignore
    } finally {
      setRefreshingTools(false)
    }
  }

  const handleArtifactGenerated = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => {
      const recent = prev.find(
        (a) => a.title === artifact.title && artifact.createdAt - a.createdAt < 5000
      )
      if (recent) return prev
      return [artifact, ...prev]
    })
  }, [])

  const handleNewChat = useCallback(() => {
    setChatSessionKey((prev) => prev + 1)
    setArtifacts([])
  }, [])

  const handleUsageEvent = useCallback((event: GeminiUsageEvent) => {
    setGeminiUsageEvents((prev) => {
      const cutoff = Date.now() - USAGE_EVENT_RETENTION_MS
      const next = [...prev, event].filter((item) => item.timestamp >= cutoff)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/10">
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold text-foreground hidden sm:block">Saviynt MCP Agent</h1>
          </div>
          <div className="hidden md:block">
            <StatusBar
              mcpConnected={mcpStatus.connected}
              mcpToolCount={tools.length}
              llmProvider="Gemini"
              usage={geminiUsageSnapshot}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewChat}
            className="h-7 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent"
          >
            <Plus className="h-3 w-3" />
            New Chat
          </Button>

          {/* Quick Start Guide Button */}
          <Button
            variant="default"
            size="sm"
            onClick={() => setGuideOpen(true)}
            className="h-7 px-2 sm:px-2.5 text-xs gap-1.5"
          >
            <BookOpen className="h-3 w-3" />
            <span className="hidden sm:inline">Start Here</span>
          </Button>

          {/* FAQ Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFaqOpen(true)}
            className="h-7 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent"
          >
            <HelpCircle className="h-3 w-3" />
            FAQ
          </Button>

          {/* API Key Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setApiKeyDialogOpen(true)}
            className={`h-7 text-xs gap-1.5 border-border bg-transparent ${apiKey ? 'text-primary border-primary/20' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Key className="h-3 w-3" />
            {apiKey ? 'API Key Set' : 'Add API Key'}
          </Button>

          {/* MCP Connect / Disconnect */}
          {!mcpStatus.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigDialogOpen(true)}
              className="h-7 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent"
            >
              <Zap className="h-3 w-3" />
              Connect MCP
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigDialogOpen(true)}
              className="h-7 text-xs gap-1.5 border-accent/30 text-accent hover:text-accent bg-transparent"
            >
              <Zap className="h-3 w-3" />
              Connected
            </Button>
          )}

          {/* Artifacts button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setArtifactsOpen(!artifactsOpen)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground relative"
            aria-label="Open artifacts"
          >
            <FileText className="h-4 w-4" />
            {artifacts.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
                {artifacts.length}
              </span>
            )}
          </Button>

          {/* GitHub repo link */}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <a
              href="https://github.com/ClarkOhlenbusch/Saviynt-mcp-showcase"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open GitHub repository"
              title="GitHub repository"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>

          {/* Theme toggle */}
          {mounted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          )}

          {/* Settings */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile status bar */}
      <div className="md:hidden px-4 py-1.5 border-b border-border bg-card/30">
        <StatusBar
          mcpConnected={mcpStatus.connected}
          mcpToolCount={tools.length}
          llmProvider="Gemini"
          usage={geminiUsageSnapshot}
        />
      </div>

      {/* Connection error banner */}
      {mcpStatus.error && !mcpStatus.connected && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2">
          <ZapOff className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">{mcpStatus.error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfigDialogOpen(true)}
            className="h-6 text-[10px] text-destructive hover:text-destructive ml-auto shrink-0"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <ChatPanel
          key={chatSessionKey}
          mcpConnected={mcpStatus.connected}
          onArtifactGenerated={handleArtifactGenerated}
          onOpenArtifacts={() => setArtifactsOpen(true)}
          artifactCount={artifacts.length}
          apiKey={apiKey}
          onOpenFaq={() => setFaqOpen(true)}
          onOpenStartHere={() => setGuideOpen(true)}
          onUsageEvent={handleUsageEvent}
        />
      </main>

      {/* MCP Config Dialog */}
      <McpConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onConnect={handleConnect}
        connecting={connecting}
      />

      {/* API Key Dialog */}
      <ApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
      />

      {/* Quick Start Guide */}
      <QuickStartGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onOpenApiKey={() => setApiKeyDialogOpen(true)}
        onOpenMcpConfig={() => setConfigDialogOpen(true)}
        onOpenFaq={() => setFaqOpen(true)}
        apiKeySet={Boolean(apiKey)}
        mcpConnected={mcpStatus.connected}
      />

      {/* FAQ Dialog */}
      <FAQDialog
        open={faqOpen}
        onOpenChange={setFaqOpen}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        mcpConnected={mcpStatus.connected}
        mcpServerUrl={mcpStatus.serverUrl}
        tools={tools}
        redactionEnabled={redactionEnabled}
        onRedactionChange={setRedactionEnabled}
        destructiveActionsEnabled={destructiveActionsEnabled}
        onDestructiveChange={setDestructiveActionsEnabled}
        onRefreshTools={handleRefreshTools}
        refreshing={refreshingTools}
      />

      {/* Artifacts Panel */}
      <ArtifactPanel
        artifacts={artifacts}
        open={artifactsOpen}
        onOpenChange={setArtifactsOpen}
      />
    </div>
  )
}
