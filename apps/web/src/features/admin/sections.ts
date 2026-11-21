// Admin sections, grouped as in the Admin mockup, with our own names (decision 0015); only the built ones have a page, the others say "later".

export interface AdminSection {
  key: string;
  label: string;
  built?: boolean;
}

export const ADMIN_GROUPS: { label: string; items: AdminSection[] }[] = [
  {
    label: 'Organisation',
    items: [
      { key: 'overview', label: 'Overview' },
      { key: 'companies', label: 'Companies', built: true },
      { key: 'users', label: 'Users', built: true },
      { key: 'roles', label: 'Roles', built: true },
      { key: 'ai-access', label: 'AI access', built: true },
      { key: 'activity', label: 'Activity', built: true },
      { key: 'channel-groups', label: 'Channel groups' },
    ],
  },
  {
    label: 'Channels',
    items: [
      { key: 'channels', label: 'Channels', built: true },
      { key: 'related-channels', label: 'Related channels' },
      { key: 'external-channels', label: 'External channels' },
      { key: 'time-zone-changes', label: 'Time-zone changes' },
    ],
  },
  {
    label: 'Scheduling rules',
    items: [
      { key: 'break-positions', label: 'Break positions', built: true },
      { key: 'clash-codes', label: 'Clash codes' },
      { key: 'time-windows', label: 'Time windows' },
      { key: 'playlist-checks', label: 'Playlist checks' },
    ],
  },
  {
    label: 'On screen',
    items: [
      { key: 'logos', label: 'Logos' },
      { key: 'secondary-events', label: 'Secondary events' },
      { key: 'sources', label: 'Sources' },
    ],
  },
  {
    label: 'Media',
    items: [
      { key: 'content-types', label: 'Categories' },
      { key: 'metadata-entities', label: 'Metadata entities' },
      { key: 'metadata-lists', label: 'Metadata lists' },
    ],
  },
  {
    label: 'Output',
    items: [
      { key: 'custom-exports', label: 'Custom exports' },
      { key: 'automatic-exports', label: 'Automatic exports' },
      { key: 'file-systems', label: 'File systems' },
      { key: 'plugins', label: 'Plugins and MAM', built: true },
      { key: 'catch-up', label: 'Catch-up platforms' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { key: 'ratings', label: 'Ratings' },
      { key: 'rating-targets', label: 'Rating targets' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'configuration', label: 'Configuration' },
      { key: 'task-viewer', label: 'Task viewer' },
      { key: 'workflows', label: 'Workflows' },
      { key: 'custom-events', label: 'Custom events' },
    ],
  },
];

export const findSection = (key: string) => ADMIN_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
