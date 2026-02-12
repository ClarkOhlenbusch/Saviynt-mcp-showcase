'use client'

import { useState, useCallback, useEffect } from 'react'
import { Settings, Zap, ZapOff, FileText, Key, HelpCircle, Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBar } from '@/components/status-bar'
import { ChatPanel } from '@/components/chat-panel'
import { SettingsModal } from '@/components/settings-modal'
import { ApiKeyDialog } from '@/components/api-key-dialog'
import { ArtifactPanel } from '@/components/artifact-panel'
import { FAQDialog } from '@/components/faq-dialog'
import { McpConfigDialog, MCP_CONFIG_STORAGE_KEY, parseMcpConfig } from '@/components/mcp-config-dialog'
import type { McpConnectionStatus, McpToolSchema, Artifact } from '@/lib/mcp/types'

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
  const [faqOpen, setFaqOpen] = useState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

  // Security settings
  const [redactionEnabled, setRedactionEnabled] = useState(true)
  const [destructiveActionsEnabled, setDestructiveActionsEnabled] = useState(false)

  // API Key state
  const [apiKey, setApiKey] = useState('')

  // Load API key from local storage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key')
    if (savedKey) {
      setApiKey(savedKey)
    }
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
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
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
          llmProvider="Claude Sonnet"
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
          mcpConnected={mcpStatus.connected}
          onArtifactGenerated={handleArtifactGenerated}
          onOpenArtifacts={() => setArtifactsOpen(true)}
          artifactCount={artifacts.length}
          apiKey={apiKey}
          onOpenFaq={() => setFaqOpen(true)}
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
