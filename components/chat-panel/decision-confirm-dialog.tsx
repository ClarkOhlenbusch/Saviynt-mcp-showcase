import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

type DecisionConfirmDialogProps = {
  open: boolean
  pendingDecision: 'approve' | 'reject' | null
  destructiveActionsEnabled: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DecisionConfirmDialog({
  open,
  pendingDecision,
  destructiveActionsEnabled,
  onOpenChange,
  onConfirm,
}: DecisionConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingDecision === 'approve' ? 'Approve this request?' : 'Reject this request?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDecision === 'approve'
              ? 'This will submit an approval action to Saviynt for the active request.'
              : 'This will submit a rejection action to Saviynt for the active request.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              pendingDecision === 'reject' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            )}
            disabled={!destructiveActionsEnabled || !pendingDecision}
            onClick={() => onConfirm()}
          >
            {pendingDecision === 'approve'
              ? 'Confirm Approval'
              : 'Confirm Rejection'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
