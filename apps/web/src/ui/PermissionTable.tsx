// A table of parts × actions whose cells are On (Allowed) · Ask (Ask first) · Off — what AI may do
// (decision 0025; mockups AiPermissions / AiTokenLimits). A cell can be capped: the choices above
// its cap are disabled, with why. A part without an action shows a dash.

import { cx } from './cx';

export type PermCell = 'on' | 'ask' | 'off';
export interface PermPart {
  key: string;
  label: string;
  holds?: string;
  actions: string[];
  notes?: Partial<Record<string, string>>;
}
export interface PermColumn {
  key: string;
  label: string;
  hint?: string;
}

const RANK: Record<PermCell, number> = { off: 0, ask: 1, on: 2 };
const LOOK: Record<PermCell, { word: string; title: string; on: string }> = {
  on: { word: 'On', title: 'Allowed', on: 'bg-green-soft text-green-text' },
  ask: { word: 'Ask', title: 'Ask first', on: 'bg-amber-soft text-amber-text' },
  off: { word: 'Off', title: 'Off', on: 'bg-surface text-text-2' },
};

export function PermissionTable({
  parts,
  columns,
  value,
  onChange,
  cap,
  compact,
  disabled,
  label,
}: {
  parts: PermPart[];
  columns: PermColumn[];
  value: Record<string, Partial<Record<string, PermCell>>>;
  onChange?: (part: string, action: string, cell: PermCell) => void;
  /** The most a cell may be, and why ("Aurora Media allows up to Ask first"). */
  cap?: (part: string, action: string) => { max: PermCell; why?: string } | null;
  /** Smaller: no "holds" line, no column hints (a token's own limits). */
  compact?: boolean;
  disabled?: boolean;
  label: string;
}) {
  const grid = { gridTemplateColumns: `minmax(${compact ? 96 : 190}px, 1.3fr) repeat(${columns.length}, minmax(${compact ? 96 : 124}px, 1fr))` };
  return (
    <div className={cx('overflow-x-auto rounded-card border border-border', disabled && 'opacity-50')} role="group" aria-label={label}>
      <div style={{ minWidth: compact ? 520 : 860 }}>
        <div className={cx('grid items-end gap-x-2.5 border-b border-border bg-surface-2', compact ? 'px-2.5 py-2' : 'px-3.5 pb-2 pt-2.5')} style={grid}>
          <span className="text-[12px] text-text-3">Part</span>
          {columns.map((c) => (
            <span key={c.key} className="flex flex-col leading-[1.3]">
              <span className="text-[12.5px] font-semibold">{c.label}</span>
              {!compact && c.hint && <span className="text-[11.5px] text-text-3">{c.hint}</span>}
            </span>
          ))}
        </div>
        {parts.map((p) => (
          <div key={p.key} className={cx('grid items-center gap-x-2.5 border-t border-hairline first:border-t-0', compact ? 'min-h-10 px-2.5 py-1.5' : 'min-h-14 px-3.5 py-2')} style={grid}>
            <span className="flex flex-col leading-[1.3]">
              <span className="font-medium">{p.label}</span>
              {!compact && p.holds && <span className="text-meta text-text-3">{p.holds}</span>}
            </span>
            {columns.map((c) => {
              if (!p.actions.includes(c.key)) {
                return (
                  <span key={c.key} className="pl-2.5 text-text-3">
                    —
                  </span>
                );
              }
              const v = value[p.key]?.[c.key] ?? 'off';
              const limit = cap?.(p.key, c.key) ?? null;
              const choices: PermCell[] = c.key === 'read' || c.key === 'export' ? ['on', 'off'] : ['on', 'ask', 'off'];
              const note = p.notes?.[c.key];
              return (
                <span key={c.key} className="flex flex-col gap-0.5">
                  <span role="radiogroup" aria-label={`${p.label}, ${c.label}`} className="inline-flex gap-0.5 self-start rounded-[7px] bg-surface-2 p-0.5">
                    {choices.map((x) => {
                      const on = v === x;
                      const above = !!limit && RANK[x] > RANK[limit.max];
                      return (
                        <button
                          key={x}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={LOOK[x].title}
                          disabled={disabled || !onChange || above}
                          title={above ? (limit?.why ?? `Up to ${LOOK[limit!.max].title}`) : LOOK[x].title}
                          onClick={() => onChange?.(p.key, c.key, x)}
                          className={cx(
                            'h-6 cursor-pointer rounded-[5px] border-0 px-2 text-[12px] font-medium disabled:cursor-default',
                            on ? `${LOOK[x].on} shadow-seg` : 'bg-transparent text-text-3',
                            above && 'opacity-35',
                          )}
                        >
                          {LOOK[x].word}
                        </button>
                      );
                    })}
                  </span>
                  {!compact && note && <span className="text-[11.5px] text-text-3">{note}</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The three words of the table, explained. */
export function PermissionLegend() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-4 gap-y-2 text-[12.5px] text-text-2">
      <span>
        <span className="rounded-badge bg-green-soft px-1.5 font-medium text-green-text">Allowed</span> the AI does it after its preview; its app asks its person first, as always.
      </span>
      <span>
        <span className="rounded-badge bg-amber-soft px-1.5 font-medium text-amber-text">Ask first</span> it waits in Agents › Waiting for you until someone who may do it approves it. A day for air: twice.
      </span>
      <span>
        <span className="rounded-badge bg-surface-3 px-1.5 font-medium text-text-2">Off</span> the AI does not get that action at all.
      </span>
    </div>
  );
}
