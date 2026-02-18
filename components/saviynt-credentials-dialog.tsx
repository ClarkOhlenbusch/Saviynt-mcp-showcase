import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserCircle, Lock, ShieldCheck } from 'lucide-react'

interface SaviyntCredentialsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    saviyntUsername: string
    saviyntPassword: string
    onSaviyntUsernameChange: (value: string) => void
    onSaviyntPasswordChange: (value: string) => void
}

export function SaviyntCredentialsDialog({
    open,
    onOpenChange,
    saviyntUsername,
    saviyntPassword,
    onSaviyntUsernameChange,
    onSaviyntPasswordChange,
}: SaviyntCredentialsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md bg-card border-border">
                <DialogHeader>
                    <DialogTitle className="text-foreground flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        EIC Credentials
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Enter your EIC credentials for automatic login. These are stored locally in your browser.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-medium uppercase text-muted-foreground ml-1">Username</label>
                        <div className="relative">
                            <Input
                                placeholder="Username"
                                value={saviyntUsername}
                                onChange={(e) => onSaviyntUsernameChange(e.target.value)}
                                className="bg-secondary/30 border-border h-9 text-xs pl-8"
                            />
                            <UserCircle className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-medium uppercase text-muted-foreground ml-1">Password</label>
                        <div className="relative">
                            <Input
                                type="password"
                                placeholder="Password"
                                value={saviyntPassword}
                                onChange={(e) => onSaviyntPasswordChange(e.target.value)}
                                className="bg-secondary/30 border-border h-9 text-xs pl-8"
                            />
                            <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>

                    <Button
                        onClick={() => onOpenChange(false)}
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-2"
                    >
                        Save Credentials
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
