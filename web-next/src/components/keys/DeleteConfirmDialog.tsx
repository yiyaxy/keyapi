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

export function DeleteConfirmDialog({
  open,
  name,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  name: string;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation('keys');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delete.title')}</DialogTitle>
          <DialogDescription>{t('delete.body', { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='secondary' onClick={() => onOpenChange(false)}>
            {t('edit.cancel')}
          </Button>
          <Button
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            disabled={isPending}
            onClick={onConfirm}
          >
            {t('delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
