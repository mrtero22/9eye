// Playlist → Day, part 3 (docs/design/day-playlist-page.md). A step that fills the day runs at once
// from the day page (one Undo step; nothing is saved until Save); here: what a finished run placed and
// why the rest was not (its Details), the Unplaced ads report (a preview that can put in what fits),
// the day's issues, each with the step that resolves it, and Manual ads.

import { useEffect, useState } from 'react';
import { FILL_STEP_LABEL, formatTc, type DayIssue, type FillMode, type FillReport, type FillStep, type FrameRate } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { Badge, Button, Dialog, DotItem, EmptyState, Notice, RadioList, SelectField, Table, TableRow } from '@/ui';
import type { BookedSpotRef, RotationListRef, RunResult } from './model';
import { plural } from './model';

/** What to run: a step, or the rotation lists of one block (a gap row). */
export interface RunRequest {
  step: FillStep;
  blockId?: string;
  blockName?: string;
  /** Unplaced ads report: what is not in the day yet and why (it can still put in what fits). */
  report?: boolean;
}

export const RUN_TITLE: Record<FillStep, string> = { programs: 'Import program placements', breaks: 'Import break events', rotation: 'Import rotation lists', commercials: 'Auto-place ads' };
const TITLE = RUN_TITLE;
const WHAT: Record<FillStep, string> = {
  commercials:
    'Each booked spot of this day’s confirmed campaigns goes into its break, once per play, while the break has room — never right after itself, and in break-position order.',
  programs: 'Each airing of this day’s confirmed plans goes into its block, split across the block’s linked breaks.',
  breaks: 'The spots of each break of this day’s ads playlist go in under the linked break that names it.',
  rotation: 'The free time of the blocks that fill their gaps is filled from a rotation list, from where the list left off. An item goes in once a day unless its list allows more.',
};

interface RunDialogProps {
  request: RunRequest | null;
  onClose: () => void;
  dayId: string;
  version: number;
  /** The draft as the API takes it. */
  blocks: () => unknown;
  /** Rows this step placed are in the day already. */
  ran: boolean;
  lists: RotationListRef[];
  /** A block of this run names its own rotation list. */
  ownLists: boolean;
  defaultListId: string | null;
  rate: FrameRate;
  onApply: (r: RunResult, step: FillStep) => void;
}

export function RunDialog(props: RunDialogProps) {
  const { request, onClose } = props;
  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      title={request?.report ? 'Unplaced ads report' : request?.blockName ? `Fill the gap of ${request.blockName}` : TITLE[request?.step ?? 'programs']}
      description={request?.report ? 'Every booked spot of this day that is not in the ads playlist yet: what can go in now, and why the rest cannot.' : WHAT[request?.step ?? 'programs']}
      width={760}
    >
      {request && <RunBody key={`${request.step}|${request.blockId ?? ''}`} {...props} request={request} />}
    </Dialog>
  );
}

function RunBody({ request, onClose, dayId, version, blocks, ran, lists, ownLists, defaultListId, rate, onApply }: RunDialogProps & { request: RunRequest }) {
  const { step } = request;
  const [mode, setMode] = useState<FillMode>('missing');
  const [list, setList] = useState<string>(ownLists ? 'own' : (defaultListId ?? ''));
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsList = step === 'rotation' && !list;

  useEffect(() => {
    setResult(null);
    setError(null);
    if (needsList) return;
    let live = true;
    setBusy(true);
    api<RunResult>('POST', `/days/${dayId}/run`, {
      step,
      mode,
      version,
      blocks: blocks(),
      listId: step === 'rotation' && list !== 'own' ? list : null,
      blockIds: request.blockId ? [request.blockId] : null,
    })
      .then((r) => live && setResult(r))
      .catch((e: unknown) => live && setError(errorText(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // blocks() is read when the step runs; the draft does not change while the dialog is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, list, dayId, version, request.blockId, needsList]);

  const r = result?.report;
  const changes = !!r && (r.placed.length > 0 || r.removed > 0);
  return (
    <>
      {ran && !request.report && (
        <RadioList<FillMode>
          label="What it placed before"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'missing', label: 'Only what is missing: what it placed before stays' },
            { value: 'all', label: 'All again: what it placed before is taken out first' },
          ]}
        />
      )}
      {step === 'rotation' && (
        <SelectField label="Rotation list" value={list} onChange={(e) => setList(e.target.value)}>
          <option value="" disabled>
            Choose a list
          </option>
          {ownLists && <option value="own">Each block’s own list</option>}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({plural(l.items, 'item')})
            </option>
          ))}
        </SelectField>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      {needsList ? (
        <EmptyState>Choose the rotation list to fill the gaps from.</EmptyState>
      ) : !r ? (
        !error && <EmptyState>{busy ? 'Looking at what can be placed…' : ''}</EmptyState>
      ) : (
        <FillResultView report={r} rate={rate} preview={!!request.report} />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {changes ? 'Cancel' : 'Close'}
        </Button>
        <Button
          variant="primary"
          disabled={!changes || busy}
          onClick={() => {
            if (result) onApply(result, step);
            onClose();
          }}
        >
          {request.report ? 'Put what can go in into the day' : 'Put into the day'}
        </Button>
      </div>
    </>
  );
}

/** What a run that already happened put into the day, and why the rest did not go in. */
export function RunResultDialog({ run, onClose, rate }: { run: { step: FillStep; blockName?: string; report: FillReport } | null; onClose: () => void; rate: FrameRate }) {
  return (
    <Dialog
      open={!!run}
      onOpenChange={(o) => !o && onClose()}
      title={run?.blockName ? `Fill the gap of ${run.blockName}` : RUN_TITLE[run?.step ?? 'programs']}
      description="What the last run put into the day, and why the rest did not go in. Undo takes it out again."
      width={760}
    >
      {run && <FillResultView report={run.report} rate={rate} />}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

/** `preview`: nothing is placed yet (the Unplaced ads report): "Can go in" / "Cannot go in". */
function FillResultView({ report, rate, preview = false }: { report: FillReport; rate: FrameRate; preview?: boolean }) {
  const ok = preview ? 'Can go in' : 'Placed';
  const no = preview ? 'Cannot go in' : 'Not placed';
  const facts = [
    `${report.placed.length} ${ok.toLowerCase()}`,
    report.notPlaced.length ? `${report.notPlaced.length} ${no.toLowerCase()}` : null,
    report.kept ? `${report.kept} already in the day` : null,
    report.removed ? `${plural(report.removed, 'row')} taken out first` : null,
  ].filter(Boolean);
  const lines = [...report.placed.map((l) => ({ ...l, ok: true })), ...report.notPlaced.map((l) => ({ ...l, ok: false }))];
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="font-medium">
        {facts.join(' · ')}
      </span>
      {report.notes.map((n) => (
        <Notice key={n}>{n}</Notice>
      ))}
      {lines.length > 0 && (
        <Table columns="96px minmax(150px, 1.4fr) minmax(110px, 1fr) minmax(170px, 1.7fr) 104px" head={['Result', 'Item', 'Block', 'Details', 'Length']} minWidth={660}>
          {lines.map((l, i) => (
            <TableRow key={i} label={`${l.ok ? ok : no}: ${l.title}`}>
              <span>
                <Badge tone={l.ok ? 'green' : 'amber'}>{l.ok ? ok : no}</Badge>
              </span>
              <span className="[overflow-wrap:anywhere]">{l.title}</span>
              <span className="text-text-2">{l.block}</span>
              <span className="text-text-2">{l.detail}</span>
              <span className="mono text-text-2">{l.frames === null ? '' : formatTc(l.frames, rate)}</span>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );
}

const ISSUE_HELP: Record<string, string> = {
  'programs-missing': 'Import program placements puts them in.',
  'programs-stale': 'Import program placements, all again, places the plans as they are now.',
  'programs-no-block': 'The plan names a block the week’s layout does not have on this day: change the plan or the layout.',
  'breaks-differ': 'Import break events, all again, copies the ads playlist’s spots in again.',
  'breaks-missing': 'Add the break to the ads playlist’s week, or link another break.',
  'rotation-gaps': 'Import rotation lists fills the free time.',
  'commercials-missing': 'Auto-place ads puts in what fits; the Unplaced ads report says why the rest does not.',
  'commercials-stale': 'Their booking changed or went. Auto-place ads, all again, places the campaigns as they are now.',
  media: 'Those rows show “Not ready” in the Media column.',
};

/** The issues of a day, each with the step that resolves it. */
export function IssuesDialog({ open, onOpenChange, issues, canRun, whyNot, onRun }: { open: boolean; onOpenChange: (o: boolean) => void; issues: DayIssue[]; canRun: boolean; whyNot: string | null; onRun: (step: FillStep) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Issues of this day" description="What still needs a look before the day is approved." width={560}>
      <div className="flex flex-col gap-3.5">
        {issues.length === 0 && <EmptyState>No issues.</EmptyState>}
        {issues.map((i) => (
          <DotItem
            key={i.key}
            tone={i.tone}
            title={i.text}
            detail={ISSUE_HELP[i.key] ?? ''}
            action={
              i.step && (
                <Button size="xs" disabled={!canRun} title={canRun ? undefined : (whyNot ?? undefined)} onClick={() => onRun(i.step!)}>
                  {FILL_STEP_LABEL[i.step]}
                </Button>
              )
            }
          />
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Manual ads: pick a commercial order, then its booked spots of
 * this day, and put them in at the selected place — one row per spot, linked to its booking.
 */
export function ManualAdsDialog({
  open,
  onOpenChange,
  booked,
  inDay,
  where,
  onPut,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booked: BookedSpotRef[];
  /** Booked spots already in the day, once per row. */
  inDay: string[];
  /** "It goes at the end of Billboard 1 13:00." */
  where: string;
  onPut: (spots: BookedSpotRef[]) => void;
}) {
  const orders = [...new Map(booked.map((b) => [b.orderId, b.orderName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const [orderId, setOrderId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const count = (id: string) => inDay.filter((x) => x === id).length;
  const spots = booked.filter((b) => b.orderId === orderId);
  useEffect(() => {
    if (!open) return;
    const first = orders[0]?.[0] ?? '';
    setOrderId(first);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // the spots of the order that still miss a pass
    setPicked(booked.filter((b) => b.orderId === orderId && count(b.id) < b.passes).map((b) => b.id));
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manual ads"
      description={`Booked spots of one campaign, put in by hand where you chose. ${where}`}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => onPut(spots.filter((s) => picked.includes(s.id)))}>
            {picked.length === 1 ? 'Put 1 spot in' : `Put ${picked.length} spots in`}
          </Button>
        </>
      }
    >
      <SelectField label="Campaign" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
        {orders.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </SelectField>
      <div className="flex max-h-[320px] shrink-0 flex-col overflow-y-auto rounded-item border border-border">
        {spots.map((s) => {
          const k = count(s.id);
          return (
            <label key={s.id} className="flex cursor-pointer items-start gap-2.5 border-t border-hairline px-3 py-2 first:border-t-0">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--accent)]"
                checked={picked.includes(s.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))}
              />
              <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                <span className="text-small font-medium [overflow-wrap:anywhere]">{s.title}</span>
                <span className="text-meta text-text-3">
                  Booked in {s.breakName}
                  {s.positionName ? ` · ${s.positionName}` : ''} · {k} of {plural(s.passes, 'play', 'plays')} in the day
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}
