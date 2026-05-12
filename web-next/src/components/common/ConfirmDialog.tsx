import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  isPending,
  confirmationText,
  confirmationLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  isPending?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('common');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const needsTypedConfirmation = Boolean(confirmationText);
  const confirmDisabled =
    Boolean(isPending) || (needsTypedConfirmation && typedConfirmation.trim() !== confirmationText);

  useEffect(() => {
    if (!open) setTypedConfirmation('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {needsTypedConfirmation && (
          <div className='space-y-2'>
            <Label htmlFor='confirm-text'>
              {confirmationLabel ??
                t('confirm.type_to_confirm', {
                  defaultValue: 'Type {{text}} to confirm',
                  text: confirmationText,
                })}
            </Label>
            <Input
              id='confirm-text'
              value={typedConfirmation}
              autoComplete='off'
              onChange={(event) => setTypedConfirmation(event.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant='secondary' onClick={() => onOpenChange(false)}>
            {cancelLabel ?? t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            className={
              danger
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
