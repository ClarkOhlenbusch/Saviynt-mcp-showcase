import type { Artifact, ToolTrace } from '../mcp/types'

export function createArtifact(
  title: string,
  markdown: string,
  type: Artifact['type'],
  evidence: ToolTrace[]
): Artifact {
  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    type,
    markdown,
    evidenceJson: evidence.map((t) => ({
      toolName: t.toolName,
      args: t.argsRedacted,
      responsePreview: t.responsePreview,
      duration: t.duration,
      success: t.success,
      timestamp: t.timestamp,
    })),
    createdAt: Date.now(),
  }
}

export function artifactToMarkdown(artifact: Artifact): string {
  let md = artifact.markdown

  md += '\n\n---\n\n'
  md += '## Appendix: Evidence References\n\n'
  md += `*Report generated: ${new Date(artifact.createdAt).toISOString()}*\n\n`

  if (artifact.evidenceJson.length > 0) {
    md += '| # | Tool | Duration | Status |\n'
    md += '|---|------|----------|--------|\n'
    artifact.evidenceJson.forEach((e, i) => {
      const ev = e as Record<string, unknown>
      md += `| ${i + 1} | ${ev.toolName} | ${ev.duration}ms | ${ev.success ? 'Success' : 'Failed'} |\n`
    })
  } else {
    md += '*No tool call evidence recorded for this artifact.*\n'
  }

  md += '\n*Note: Evidence data has been sanitized. Sensitive fields have been redacted.*\n'
  md += '*Evidence based on real MCP tool call data.*\n'

  return md
}

export function artifactToEvidenceJson(artifact: Artifact): string {
  return JSON.stringify(
    {
      artifactId: artifact.id,
      title: artifact.title,
      type: artifact.type,
      generatedAt: new Date(artifact.createdAt).toISOString(),
      evidence: artifact.evidenceJson,
      disclaimer: 'Sensitive data has been redacted. Evidence based on real MCP tool call data.',
    },
    null,
    2
  )
}
