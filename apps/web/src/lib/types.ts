// Shapes the API sends (apps/api/src/services/dto.ts).

import type { AdsBlock, AiringDraft, BlockDraft, BlockTypeInfo, OrderMode, OrderStatus, TimeWindows } from '@9eye/core';

export type PlaylistKind = 'main' | 'ads';

/** The signed-in person (decision 0021). */
export interface Me {
  id: string;
  name: string;
  email: string;
  platformAdmin: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
}

export interface Channel {
  id: string;
  name: string;
  code: string;
  frameRate: string;
  dayStartFrames: number;
  weekStart: number;
  timeZone: string | null;
  dateLocale: string;
  ageLogoPosition: string | null;
  defaultBreakListId: string | null;
  shortestBreakFrames: number;
  defaultRotationListName: string | null;
  defaultExport: string | null;
  allowedExports: string[];
  epgTypes: string[];
  bxfTimesUtc: boolean;
  reconcileTolerance: number;
  version: number;
  mainPlaylistId: string | null;
  adsPlaylistId: string | null;
  templateCount: number;
  /** The channel's current broadcast day, from the server. */
  today: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  kind: PlaylistKind;
  playlistId: string;
  channelId: string;
  validFrom: string;
  validTo: string;
  activeWeekdays: boolean[];
  version: number;
  updatedAt: string;
}

export interface TemplateFull {
  template: TemplateSummary;
  channel: Channel;
  blocks: BlockDraft[];
  ads: { template: TemplateSummary | null; days: AdsBlock[][] } | null;
  main: { template: TemplateSummary | null; blocks: Pick<BlockDraft, 'id' | 'weekday' | 'blockTypeId' | 'startFrames' | 'lengthFrames' | 'breaks'>[] } | null;
}

export interface BlockType extends BlockTypeInfo {
  textColor: string;
  fillGaps: boolean;
  opensWithBreak: boolean;
  note: string;
  kind: PlaylistKind;
  channelId: string;
  channelName: string;
  usedCount: number;
}

export interface BlockGroup {
  id: string;
  name: string;
  color: string | null;
}

export interface BreakList {
  id: string;
  channelId: string;
  name: string;
  positions: number[];
}

export interface ChannelUsage {
  templates: TemplateSummary[];
  blockTypeCount: number;
  adsBlockTypeCount: number;
  mainTemplatesWithBreaks: string[];
}

/** An advertiser or agency (Orders → Clients). */
export interface Client {
  id: string;
  name: string;
  type: 'advertiser' | 'agency' | 'both';
  country: string;
  address: string;
  billingAddress: string;
  web: string;
  email: string;
  phone: string;
  fax: string;
  vatNumber: string;
  notes: string;
  /** Seconds a spot may air from its booked time when the as-run is matched; null = off. */
  toleranceSeconds: number | null;
  contracts: number;
  version: number;
}

/** A client's campaign: channels, dates, currency (Orders → Contracts). */
export interface ContractListItem {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  currency: string;
  channelIds: string[];
  orders: number;
  spotsBooked: number;
}

export interface ContractOrder {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  startDate: string;
  endDate: string;
  status: 'confirmed' | 'draft';
  spots: number;
  spotsBooked: number;
}

export interface Contract extends ContractListItem {
  totalAgreed: number;
  notes: string;
  version: number;
  ordersList: ContractOrder[];
}

/** One commercial order (Orders → a contract → an order). */
export interface CommercialOrder {
  id: string;
  name: string;
  status: 'confirmed' | 'draft';
  startDate: string;
  endDate: string;
  color: string;
  version: number;
  contract: { id: string; name: string; clientName: string; startDate: string; endDate: string };
  channel: Channel;
  template: { id: string; name: string };
  items: { id: string; productionId: string; title: string; code: string; lengthFrames: number | null; booked: number }[];
  booked: number;
  breaks: { breakTypeId: string; name: string; startFrames: number; weekdays: boolean[] }[];
}

/** A booked spot: a spot of the order in an ad break of a block on a day. */
export interface Booking {
  date: string;
  blockTypeId: string;
  breakTypeId: string;
  orderItemId: string;
  positionId: string | null;
  passes: number;
}

export interface CommercialWeek {
  from: string;
  to: string;
  days: {
    date: string;
    inOrder: boolean;
    boxes: {
      blockTypeId: string;
      name: string;
      color: string;
      startFrames: number;
      lengthFrames: number;
      breaks: { breakTypeId: string; name: string; startFrames: number; lengthFrames: number; othersFrames: number }[];
    }[];
  }[];
  bookings: Booking[];
}

/** Where in an ad break a booked spot goes (Admin → Break positions); order 1 = first. */
export interface BreakPosition {
  id: string;
  name: string;
  order: number;
  isDefault: boolean;
  color: string | null;
  /** Percent on the spot's price. */
  priceModifier: number;
  /** Content types that may take it; empty = any. */
  contentTypeIds: string[];
  version: number;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  fixed: boolean;
  system: boolean;
  members: number;
  grants: { module: string; action: string }[];
  allChannels: boolean;
  channelIds: string[];
  version: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  platformAdmin: boolean;
  mfaEnabled: boolean;
  lastActiveAt: string | null;
  status: 'invited' | 'active';
  roleId: string;
  memberships: { company: string; role: string; current: boolean }[];
}

export interface AdminCompany {
  id: string;
  name: string;
  slug: string;
  current: boolean;
  channelCount: number;
  templateCount: number;
  exports: string[];
}

// ---------------------------------------------------------------- AI access (decisions 0023, 0025; ai-access-page.md)

/** What AI may do in a company, in one word (the Agents page): off · read (it changes nothing) · edit. */
export type AiAccessLevel = 'off' | 'read' | 'edit';

/** A cell of the AI table: Allowed, Ask first, Off (decision 0025). */
export type AiCell = 'on' | 'ask' | 'off';
export type AiPart = 'media' | 'layouts' | 'scheduling' | 'playlist' | 'ads' | 'channels';
export type AiAction = 'read' | 'change' | 'create' | 'approve' | 'export';
export type AiTable = Record<AiPart, Partial<Record<AiAction, AiCell>>>;
export type AiPreset = 'read' | 'drafts' | 'full' | 'custom';

/** The rows and columns of the table. */
export interface AiTableShape {
  parts: { key: AiPart; label: string; holds: string; actions: AiAction[]; notes: Partial<Record<AiAction, string>> }[];
  actions: { key: AiAction; label: string; hint: string }[];
}

export interface AiToken {
  id: string;
  name: string;
  /** Its limits let it change something (its person's role still decides each step). */
  access: 'read' | 'edit';
  /** same: follows the company · read: reads only · custom: its own table. */
  limits: 'same' | 'read' | 'custom';
  limitsText: string;
  table: AiTable | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  /** working · expired · revoked · left (its person may not open the company any more) */
  state: 'ok' | 'expired' | 'revoked' | 'left';
  company: { id: string; slug: string; name: string };
  person: { id: string; name: string; email: string };
}

export interface MyAiCompany {
  id: string;
  slug: string;
  name: string;
  on: boolean;
  table: AiTable;
  preset: AiPreset;
  maxDays: number;
  role: string;
  canEdit: boolean;
  /** For each cell, the person's role allows it. */
  roleCan: Record<AiPart, Partial<Record<AiAction, boolean>>>;
}

export interface MyAiAccess {
  tokens: AiToken[];
  companies: MyAiCompany[];
  shape: AiTableShape;
}

export interface AiPolicy {
  on: boolean;
  table: AiTable;
  preset: AiPreset;
  maxDays: number;
  dayChoices: number[];
  shape: AiTableShape;
}

/** One event of Settings › Activity (the audit log). */
export interface ActivityEvent {
  id: string;
  at: string;
  person: { id: string; name: string; email: string } | null;
  via: 'web' | 'mcp';
  tokenId: string | null;
  tokenName: string | null;
  /** "PUT /days/:id", or "tool fill_day" */
  action: string;
  targetId: string | null;
  channelIds: string[];
  ok: boolean;
  status: number | null;
  message: string | null;
  input: unknown;
  /** An MCP change that undo_change can put back. */
  hasUndo: boolean;
}

export interface Connection {
  id: string;
  kind: string;
  adapter: string;
  label: string;
  detail: string;
  channelCount: number;
  address: string;
  userName: string;
  hasCredentials: boolean;
  status: 'not-connected' | 'set-up';
}

// ---------------------------------------------------------------- catalog (shared catalog picker)

export type CatalogFamily = 'program' | 'filling' | 'advert';

export interface ContentType {
  id: string;
  name: string;
  family: CatalogFamily;
  color: string | null;
  contentCount: number;
}

export interface CatalogContent {
  id: string;
  title: string;
  code: string;
  contentTypeId: string;
  productionCount: number;
}

export interface Production {
  id: string;
  contentId: string;
  title: string;
  code: string;
  chapter: number | null;
  isTemplate: boolean;
  lengthFrames: number | null;
  starts: string | null;
  expires: string | null;
  mediaStatus: 'ready' | 'not-ready' | null;
}

export interface CatalogSearchHit extends Production {
  contentTitle: string;
  contentTypeId: string;
  typeName: string;
}

// ---------------------------------------------------------------- orders (Scheduling page)

export type { AiringDraft, OrderDraft, OrderMode, OrderStatus, TimeWindows } from '@9eye/core';

export interface CompactTemplate {
  id: string;
  name: string;
  validFrom: string;
  validTo: string;
  blocks: { weekday: number; blockTypeId: string; startFrames: number; lengthFrames: number; breakCount: number }[];
  blockTypes: Record<string, { name: string; color: string }>;
}

export interface OrderIssue {
  short: string;
  text: string;
  fix: { label: string; action: 'new-order' | 'confirm' | 'end-on' | 'change-end' | 'show-items' | 'open-week'; date?: string } | null;
}

export interface OrderSummary {
  id: string;
  name: string;
  mode: OrderMode;
  status: OrderStatus;
  startDate: string;
  endDate: string;
  color: string;
  itemCount: number;
  aired: number;
  placed: number;
  week: { firsts: { date: string; clock: string; chapter: number | null }[]; repeats: number; passes: { date: string; passes: number }[]; blocksPerDay: number };
  lastAiring: string | null;
  issue: OrderIssue | null;
}

export interface OrderList {
  channel: Channel;
  weekFrom: string;
  orders: OrderSummary[];
}

export interface OrderItem {
  id: string;
  position: number;
  productionId: string;
  title: string;
  chapter: number | null;
  code: string;
  contentId: string;
  contentTitle: string;
  contentTypeId: string;
  lengthFrames: number | null;
  catalogLengthFrames: number | null;
  mediaStatus: string | null;
}

export interface OrderFull {
  order: {
    id: string;
    name: string;
    mode: OrderMode;
    status: OrderStatus;
    startDate: string;
    endDate: string;
    color: string;
    firstItemId: string | null;
    reuseInLoop: boolean;
    maxAirings: number | null;
    totalAirings: number | null;
    timeWindows: TimeWindows;
    version: number;
    updatedAt: string;
  };
  channels: { channel: Channel; template: CompactTemplate }[];
  items: OrderItem[];
  airings: AiringDraft[];
  issue: OrderIssue | null;
}

export interface WeekAiring {
  id: string;
  orderId: string;
  orderName: string;
  orderColor: string;
  mode: OrderMode;
  status: OrderStatus;
  date: string;
  blockTypeId: string;
  kind: 'first' | 'repeat';
  passes: number;
  titles: string[];
  chapters: (number | null)[];
  firstDate: string | null;
  blockColor: string | null;
}

export interface ChannelWeek {
  template: CompactTemplate | null;
  airings: WeekAiring[];
}

// ---------------------------------------------------------------- Catalog page (apps/api/src/services/catalog*.ts)

export type { CatalogLevel, SearchCondition, RelationKind, RelationTab } from '@9eye/core';

export interface CatalogLookups {
  frameRate: string;
  today: string;
  weekStart: number;
  companyName: string;
  bulkMax: number;
  sources: { id: string; name: string; code: string; pattern: string }[];
  logos: { id: string; name: string; typeNumber: number }[];
  secondaryActions: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  customFields: { key: string; label: string }[];
  timeWindows: { id: string; name: string; color: string | null; lengthFrames: number }[];
  productCodes: { id: string; name: string }[];
  graphicSources: { id: string; name: string }[];
  graphicTemplates: {
    id: string; name: string; sourceId: string; startType: string; startOffsetFrames: number; startTcInFrames: number; endType: string;
    endDurationFrames: number; endTcOutFrames: number; frequency: string; repeatIntervalFrames: number; repeatCount: number; layer: string;
  }[];
  graphicObjects: { id: string; name: string; sourceId: string }[];
  companies: string[];
}

export interface CatalogColumnRow {
  id: string;
  name: string;
  meta: string;
  metaTone: 'amber' | null;
  color: string | null;
  media: boolean;
  last: boolean;
}

export interface CatalogColumnResult {
  total: number;
  rows: CatalogColumnRow[];
}

/** A catalog item as the form reads it: its fields, `version`, and the names of what it hangs under. */
export type CatalogItem = Record<string, unknown> & { id: string; version: number };

export interface CatalogDeleteRow {
  id: string;
  name: string;
  usedBy: string | null;
}

export interface CatalogRelationRow {
  id: string | null;
  kind: import('@9eye/core').RelationKind;
  channelId: string | null;
  params: Record<string, unknown>;
  inherited: boolean;
  from: string | null;
}

export interface CatalogRelations {
  tabs: import('@9eye/core').RelationTab[];
  rows: CatalogRelationRow[];
  names: Record<string, string>;
}

// ---------------------------------------------------------------- agents (decision 0024)

export type ProviderName = 'anthropic' | 'openai' | 'xai';
export type PartKey = 'scheduling' | 'playlist' | 'ads' | 'media' | 'layouts';
export type PartLevel = 'read' | 'edit';
export type Parts = Partial<Record<PartKey, PartLevel>>;

export interface AiProvider {
  provider: ProviderName;
  label: string;
  set: boolean;
  last4: string | null;
  updatedAt: string | null;
}

export interface AgentBrief {
  id: string;
  name: string;
  mark: string;
  color: string;
}

export interface Agent extends AgentBrief {
  job: string;
  provider: ProviderName;
  model: string;
  role: { id: string; name: string };
  parts: Parts;
  channelIds: string[];
  skill: string;
  worksWith: string[];
  enabled: boolean;
  maxSteps: number;
  monthlyTokens: number;
  usedTokens: number;
  waiting: number;
  running: boolean;
  nextRoutineAt: string | null;
  version: number;
  createdAt: string;
  deleted: boolean;
}

export interface AgentDetail extends Agent {
  memory: { id: string; text: string; source: string; createdAt: string }[];
  skills: { id: string; skill: string; via: string; changedBy: string | null; createdAt: string }[];
}

export interface AgentTemplate {
  key: string;
  name: string;
  mark: string;
  color: string;
  job: string;
  parts: Parts;
  skill: string;
}

export interface AgentsOverview {
  agents: Agent[];
  rooms: AgentRoom[];
  waiting: number;
  providers: AiProvider[];
  roles: { id: string; name: string }[];
  templates: AgentTemplate[];
  parts: { key: PartKey; label: string; canChange: boolean }[];
  claudeModels: { id: string; label: string }[];
  defaultModel: { provider: ProviderName; model: string };
  canManage: boolean;
  aiAccess: AiAccessLevel;
}

export interface AgentRoom {
  id: string;
  name: string;
  description: string;
}

export type AgentChangeState = 'waiting' | 'applying' | 'approved' | 'rejected' | 'failed' | 'undone';

export interface AgentChange {
  id: string;
  agent: AgentBrief;
  tool: string;
  title: string;
  preview: string;
  status: AgentChangeState;
  result: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  room: { id: string; name: string } | null;
  target: AgentChangeTarget | null;
  /** What the agent does next once it is applied (a chained change). */
  then: string | null;
  /** It puts a day on air: approved twice. */
  toAir: boolean;
  /** An agent prepared it, or an AI app asked first (decision 0025). */
  from: { kind: 'agent' } | { kind: 'app'; token: string; person: string };
  canDecide: boolean;
  canUndo: boolean;
}

/** A waiting day change as the day would be after it (GET /agents/changes/:id/day). */
export interface AgentDayPreview {
  blocks: { id: string; events: Record<string, unknown>[] }[];
  /** Rows it adds or changes. */
  changed: string[];
  removed: number;
  problems: string[];
}

export type AgentChangeTarget =
  | { kind: 'day'; channelId: string; date: string | null; playlist: 'main' | 'ads'; step: string; mode: string }
  | { kind: 'weeks'; channelId: string; from: string; to: string }
  | { kind: 'campaign'; campaignId: string; from: string | null; to: string | null };

export type RoutineEvent = 'week_created' | 'campaign_confirmed';

export interface AgentRoutine {
  id: string;
  agentId: string;
  name: string;
  kind: 'time' | 'event';
  time: string | null;
  weekdays: boolean[];
  timeZone: string;
  event: RoutineEvent | null;
  eventLabel: string | null;
  channelIds: string[];
  request: string;
  room: { id: string; name: string } | null;
  enabled: boolean;
  createdBy: { id: string; name: string };
  nextRunAt: string | null;
  lastRunAt: string | null;
  canChange: boolean;
}

export interface AgentMessage {
  id: string;
  roomId: string | null;
  threadId: string | null;
  author: { kind: 'person'; id: string | null; name: string } | ({ kind: 'agent' } & AgentBrief);
  kind: 'text' | 'change' | 'skill' | 'memory' | 'error';
  text: string;
  skill: { skill: string; before: string; status: string; decidedBy: string | null } | null;
  change: AgentChange | null;
  /** The routine whose run wrote it. */
  routine: string | null;
  createdAt: string;
}

export interface AgentRunBrief {
  id: string;
  agent: AgentBrief;
  trigger: string;
  startedAt: string;
}

export interface AgentThread {
  messages: AgentMessage[];
  running: AgentRunBrief[];
}

export interface AgentRun {
  id: string;
  trigger: string;
  status: 'running' | 'done' | 'stopped' | 'failed';
  requestedBy: string | null;
  room: string | null;
  startedAt: string;
  endedAt: string | null;
  tokens: number;
  error: string | null;
  tools: string[];
  changes: { id: string; title: string; status: AgentChangeState }[];
}
