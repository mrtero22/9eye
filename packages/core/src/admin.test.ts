import { describe, expect, it } from 'vitest';
import { ALL_GRANTS, FRAME_RATES, SYSTEM_ROLES, connectionLabel, exportFileName, grantApplies, minutesToFrames } from './index';

const R = FRAME_RATES['25'];

describe('roles', () => {
  it('knows which actions a module has', () => {
    expect(grantApplies('admin', 'export')).toBe(false);
    expect(grantApplies('catalog', 'approve')).toBe(false);
    expect(grantApplies('orders', 'approve')).toBe(true);
    expect(grantApplies('nope', 'view')).toBe(false);
    expect(ALL_GRANTS).toHaveLength(7 * 4 - 3);
    expect(SYSTEM_ROLES.find((r) => r.key === 'company-admin')!.grants).toHaveLength(25);
  });
});

describe('export file names', () => {
  it('names the Playout XML file after the playlist start', () => {
    expect(exportFileName('playout-xml', '2026-10-15', minutesToFrames(360, R), R, 'AURORASD')).toBe('2026_10_15_06_00_00.xml');
    expect(exportFileName('playout-xml', '2026-10-17', minutesToFrames(60, R), R, 'X')).toBe('2026_10_17_01_00_00.xml');
  });
  it('uses each exporter’s own pattern', () => {
    expect(exportFileName('bxf', '2026-10-15', 0, R, 'AURORASD')).toBe('BXF20261015_AURORASD.xml');
    expect(exportFileName('qms', '2026-10-15', 0, R, 'AURORASD')).toBe('2026_10_15_AURORASD.xml');
    expect(exportFileName('nexio', '2026-10-15', 0, R, 'AURORASD')).toBe('AURORASD20261015.txt');
    expect(exportFileName('adc', '2026-10-15', 0, R, 'AURORASD')).toBe('20261015AURORASD.bxf');
    expect(exportFileName('csv', '2026-10-15', 0, R, 'AURORASD')).toBe('20261015_AURORASD.csv');
  });
  it('labels connections', () => {
    expect(connectionLabel('playout', 'playout-xml')).toBe('Playout export · Playout XML');
    expect(connectionLabel('mam', 'compact-mam')).toBe('MAM · Compact MAM');
  });
});
