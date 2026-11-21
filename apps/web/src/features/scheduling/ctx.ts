// What the parts of an open order's page share.

import type { AiringDraft, OrderDraft, OrderRuleContext, TemplateDay } from '@9eye/core';
import type { Channel, CompactTemplate, OrderFull, WeekAiring } from '@/lib/types';
import type { Edit } from './edits';
import type { ItemInfo, ItemsById, TimeCtx } from './model';

export interface OrderCtx {
  full: OrderFull;
  draft: OrderDraft;
  /** Applies a change as one undo step; a refusal is shown to the user. */
  apply: (e: Edit | OrderDraft) => boolean;
  dirty: boolean;
  /** The channel shown (the order's own, or another of a multi-channel order). */
  channelId: string;
  channel: Channel;
  template: CompactTemplate;
  days: TemplateDay[];
  rules: OrderRuleContext;
  t: TimeCtx;
  items: ItemsById;
  info: Map<string, ItemInfo>;
  addInfo: (m: Map<string, ItemInfo>) => void;
  byId: Map<string, AiringDraft>;
  /** First day of the shown week, and its last. */
  ws: string;
  we: string;
  /** Other orders' airings of the shown week. */
  others: WeekAiring[];
  selectBlock: (date: string, blockTypeId: string) => void;
  openWeek: (date: string) => void;
  /** Opens another order (asks first when this one has unsaved changes). */
  openOrder: (id: string, at?: { date: string; blockTypeId: string }) => void;
}
