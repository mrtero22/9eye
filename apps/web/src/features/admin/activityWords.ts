// The words Settings › Activity shows for an audit action (docs/design/ai-access-page.md): one table
// keyed by the action ("PUT /days/:id", "tool fill_day"); an action without words is named from its
// method and its first address word.

const WORDS: Record<string, string> = {
  // days and weeks
  'PUT /days/:id': 'Saved the day',
  'POST /days/:id/publish': 'Approved the day',
  'POST /days/:id/unpublish': 'Reopened the day',
  'POST /channels/:id/weeks': 'Created weeks',
  'PATCH /weeks/:id': 'Renamed a week',
  'DELETE /weeks/:id': 'Deleted a week',
  // layouts
  'POST /templates': 'Made a layout',
  'PUT /templates/:id': 'Saved a layout',
  'POST /templates/:id/clone': 'Cloned a layout',
  'DELETE /templates/:id': 'Deleted a layout',
  // plans and campaigns
  'POST /orders': 'Made a plan',
  'PUT /orders/:id': 'Saved a plan',
  'DELETE /orders/:id': 'Deleted a plan',
  'POST /commercials/orders/:id/book': 'Booked spots',
  'PUT /commercials/orders/:id/week': 'Saved a campaign week',
  'PUT /commercials/orders/:id': 'Saved a campaign',
  'POST /commercials/contracts': 'Made a deal',
  'PUT /commercials/contracts/:id': 'Saved a deal',
  'POST /commercials/clients': 'Added a client',
  // settings and access
  'PUT /channels/:id': 'Saved channel settings',
  'PUT /admin/roles/:id': 'Saved a role',
  'POST /admin/users': 'Invited a person',
  'PUT /admin/ai-access': 'Changed AI access',
  'POST /me/ai-tokens': 'Made an AI token',
  'DELETE /me/ai-tokens/:id': 'Revoked an AI token',
  'DELETE /admin/ai-tokens/:id': 'Revoked an AI token',
  // AI apps (MCP tools)
  'tool fill_day': 'Filled the day',
  'tool create_weeks': 'Created weeks',
  'tool book_campaign_spots': 'Booked spots',
  'tool undo_change': 'Undid a change',
  'tool list_channels': 'Read the channels',
  'tool get_day_playlist': 'Read the day playlist',
  'tool check_day': 'Checked the day',
  'tool search_media': 'Searched Media',
  'tool list_plans': 'Read the plans',
  'tool list_deals': 'Read the deals',
  'tool get_deal': 'Read a deal',
  'tool get_campaign': 'Read a campaign',
};

const WRITE_TOOLS = new Set(['tool fill_day', 'tool create_weeks', 'tool book_campaign_spots', 'tool undo_change']);
const NOUN: Record<string, string> = {
  channels: 'a channel', templates: 'a layout', 'block-types': 'a block type', 'break-lists': 'a break list', weeks: 'a week', days: 'a day',
  catalog: 'Media', orders: 'a plan', commercials: 'an ad item', admin: 'a setting',
};
const VERB: Record<string, string> = { POST: 'Made', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };

const inputOf = (input: unknown) => (input && typeof input === 'object' ? (input as Record<string, unknown>) : {});

/** A write tool called without apply: true only previewed. */
export const isPreview = (action: string, input: unknown) => WRITE_TOOLS.has(action) && action !== 'tool undo_change' && inputOf(input).apply !== true;

/** It changed nothing: an AI read, or a preview. */
export const isRead = (action: string, input: unknown) => (action.startsWith('tool ') && !WRITE_TOOLS.has(action)) || isPreview(action, input);

export function activityWords(action: string, input: unknown): string {
  const words = WORDS[action];
  if (words) {
    const step = action === 'tool fill_day' ? inputOf(input).step : null;
    const full = typeof step === 'string' ? `${words} (${step})` : words;
    return isPreview(action, input) ? `Previewed: ${full.charAt(0).toLowerCase()}${full.slice(1)}` : full;
  }
  if (action.startsWith('tool ')) return `Used ${action.slice(5).replace(/_/g, ' ')}`;
  const [method, path = ''] = action.split(' ');
  return `${VERB[method] ?? 'Changed'} ${NOUN[path.split('/')[1]] ?? 'something'}`;
}

/** The item an event names: its channels and the day or week its input names. */
export function activityItem(input: unknown, channelNames: string[]): string {
  const i = inputOf(input);
  const channel = typeof i.channel === 'string' ? i.channel : channelNames.join(', ');
  const when = [i.date, i.from_week, i.from && i.to ? `${i.from} → ${i.to}` : null].find((x) => typeof x === 'string' && x);
  const name = typeof i.name === 'string' && !channel ? `"${i.name}"` : null;
  return [channel || null, typeof i.playlist === 'string' ? i.playlist : null, when ?? null, name].filter(Boolean).join(' · ') || '—';
}

/** What was sent, as label / value lines (objects as JSON). */
export function inputLines(input: unknown): { k: string; v: string }[] {
  return Object.entries(inputOf(input)).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }));
}
