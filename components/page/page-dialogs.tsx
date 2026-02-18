import { ApiKeyDialog } from '@/components/api-key-dialog'
import { ArtifactPanel } from '@/components/artifact-panel'
import { FAQDialog } from '@/components/faq-dialog'
import { McpConfigDialog } from '@/components/mcp-config-dialog'
import { QuickStartGuideDialog } from '@/components/quick-start-guide-dialog'
import { SettingsModal } from '@/components/settings-modal'
import { SaviyntCredentialsDialog } from '@/components/saviynt-credentials-dialog'
import type { Artifact, McpToolSchema } from '@/lib/mcp/types'

type PageDialogsProps = {
  configDialogOpen: boolean
  setConfigDialogOpen: (open: boolean) => void
  connecting: boolean
  onConnect: (serverUrl: string, authHeader: string) => Promise<void>
  apiKeyDialogOpen: boolean
  setApiKeyDialogOpen: (open: boolean) => void
  apiKey: string
  onApiKeyChange: (key: string) => void
  saviyntUsername: string
  onSaviyntUsernameChange: (value: string) => void
  saviyntPassword: string
  onSaviyntPasswordChange: (value: string) => void
  guideOpen: boolean
  setGuideOpen: (open: boolean) => void
  faqOpen: boolean
  setFaqOpen: (open: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  saviyntDialogOpen: boolean
  setSaviyntDialogOpen: (open: boolean) => void
  artifactsOpen: boolean
  setArtifactsOpen: (open: boolean) => void
  apiKeySet: boolean
  mcpConnected: boolean
  mcpServerUrl: string
  tools: McpToolSchema[]
  redactionEnabled: boolean
  onRedactionChange: (enabled: boolean) => void
  destructiveActionsEnabled: boolean
  onDestructiveChange: (enabled: boolean) => void
  onRefreshTools: () => Promise<void>
  refreshing: boolean
  artifacts: Artifact[]
}

export function PageDialogs({
  configDialogOpen,
  setConfigDialogOpen,
  connecting,
  onConnect,
  apiKeyDialogOpen,
  setApiKeyDialogOpen,
  apiKey,
  onApiKeyChange,
  saviyntUsername,
  onSaviyntUsernameChange,
  saviyntPassword,
  onSaviyntPasswordChange,
  guideOpen,
  setGuideOpen,
  faqOpen,
  setFaqOpen,
  settingsOpen,
  setSettingsOpen,
  saviyntDialogOpen,
  setSaviyntDialogOpen,
  artifactsOpen,
  setArtifactsOpen,
  apiKeySet,
  mcpConnected,
  mcpServerUrl,
  tools,
  redactionEnabled,
  onRedactionChange,
  destructiveActionsEnabled,
  onDestructiveChange,
  onRefreshTools,
  refreshing,
  artifacts,
}: PageDialogsProps) {
  return (
    <>
      <McpConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onConnect={onConnect}
        connecting={connecting}
      />

      <ApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
        apiKey={apiKey}
        onApiKeyChange={onApiKeyChange}
      />

      <QuickStartGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onOpenApiKey={() => setApiKeyDialogOpen(true)}
        onOpenMcpConfig={() => setConfigDialogOpen(true)}
        onOpenFaq={() => setFaqOpen(true)}
        apiKeySet={apiKeySet}
        mcpConnected={mcpConnected}
      />

      <FAQDialog
        open={faqOpen}
        onOpenChange={setFaqOpen}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        mcpConnected={mcpConnected}
        mcpServerUrl={mcpServerUrl}
        tools={tools}
        redactionEnabled={redactionEnabled}
        onRedactionChange={onRedactionChange}
        destructiveActionsEnabled={destructiveActionsEnabled}
        onDestructiveChange={onDestructiveChange}
        onRefreshTools={onRefreshTools}
        refreshing={refreshing}
      />

      <SaviyntCredentialsDialog
        open={saviyntDialogOpen}
        onOpenChange={setSaviyntDialogOpen}
        saviyntUsername={saviyntUsername}
        onSaviyntUsernameChange={onSaviyntUsernameChange}
        saviyntPassword={saviyntPassword}
        onSaviyntPasswordChange={onSaviyntPasswordChange}
      />

      <ArtifactPanel
        artifacts={artifacts}
        open={artifactsOpen}
        onOpenChange={setArtifactsOpen}
      />
    </>
  )
}
