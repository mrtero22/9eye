// Things that happened in a company, for whoever listens (decision 0024, phase B: an agent's routine
// can start on them). Services say what happened after it is saved; a listener never stops them.

export type CompanyEvent =
  | { kind: 'week_created'; channelId: string; text: string }
  | { kind: 'campaign_confirmed'; channelId: string; text: string };

type Listener = (tenantId: string, e: CompanyEvent) => Promise<unknown> | unknown;
const listeners = new Set<Listener>();
const pending = new Set<Promise<unknown>>();

export function onCompanyEvent(fn: Listener): void {
  listeners.add(fn);
}

/** Tells every listener; their failures are logged, never thrown at the service that saved. */
export function companyEvent(tenantId: string, e: CompanyEvent): void {
  for (const fn of listeners) {
    const p = Promise.resolve()
      .then(() => fn(tenantId, e))
      .catch((err) => console.error('company event', e.kind, err))
      .finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** Tests: the listeners still at work. */
export const eventsAtWork = () => [...pending];
