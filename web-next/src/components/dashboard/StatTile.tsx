import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StatTile({ label, value }: { label: string; value: string | undefined }) {
  return (
    <Card className='flex-1'>
      <CardHeader>
        <CardTitle className='eyebrow'>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='h3'>{value ?? '—'}</div>
      </CardContent>
    </Card>
  );
}
