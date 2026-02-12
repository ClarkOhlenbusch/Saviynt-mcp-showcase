'use client'

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Key, ExternalLink, Save, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface ApiKeyDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    apiKey: string
    onApiKeyChange: (key: string) => void
}

export function ApiKeyDialog({
    open,
    onOpenChange,
    apiKey,
    onApiKeyChange,
}: ApiKeyDialogProps) {
    const [saving, setSaving] = useState(false)

    async function handleSaveToDb() {
        if (!apiKey) {
            toast.error('Please enter a key first')
            return
        }
        setSaving(true)
        try {
            const res = await fetch('/api/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key_value: apiKey, label: 'Gemini Key' }),
            })
            if (res.ok) {
                toast.success('Key saved to database')
            } else {
                toast.error('Failed to save key')
            }
        } catch (err) {
            toast.error('Failed to save key')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md bg-card border-border">
                <DialogHeader>
                    <DialogTitle className="text-foreground flex items-center gap-2">
                        <Key className="h-4 w-4 text-primary" />
                        Gemini API Key
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Enter your API key to use the agent.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    <div className="rounded-lg bg-secondary/50 p-4 flex flex-col gap-3 text-sm">
                        <div className="flex flex-col gap-2">
                            <p className="text-xs text-muted-foreground">
                                To use the agent, you need a Gemini API key. You can get a free key from Google AI Studio.
                            </p>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 w-fit font-medium"
                            >
                                Get API Key <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                        <div className="space-y-1.5 pt-2">
                            <label className="text-xs font-medium text-foreground">API Key</label>
                            <div className="flex gap-2">
                                <Input
                                    type="password"
                                    placeholder="Enter your Gemini API Key"
                                    value={apiKey}
                                    onChange={(e) => onApiKeyChange(e.target.value)}
                                    className="bg-background flex-1"
                                />
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-9 shrink-0 gap-1.5"
                                    onClick={handleSaveToDb}
                                    disabled={saving || !apiKey}
                                >
                                    {saving ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5" />
                                    )}
                                    Save
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
