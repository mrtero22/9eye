import { EmptyState, PageHeader } from '@/ui';

/** Modules that are specified but not built yet. */
export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="max-w-xl px-4 pt-6 sm:px-8">
        <EmptyState>{text}</EmptyState>
      </div>
    </>
  );
}
