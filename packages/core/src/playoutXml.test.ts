import { describe, expect, it } from 'vitest';
import { FRAME_RATES, PLAYOUT_XML_LEFT_OUT, playoutXmlColor, playoutXmlFile, playoutXmlFirstItemId, playoutXmlPrefix, playoutXmlRootName, playoutXmlSeconds, playoutXmlTitle } from './index';

const r25 = FRAME_RATES['25'];
const s = (seconds: number) => Math.round(seconds * 25);

describe('the Playout XML playlist file', () => {
  it('writes the first items of a sample day of AURORA SD character for character', () => {
    const file = playoutXmlFile({
      rootId: '10000000000042',
      name: playoutXmlRootName(playoutXmlPrefix('aurora-media'), '2026-10-15', 6 * 3600 * 25, r25),
      firstItemId: 1001,
      rate: r25,
      items: [
        { file: 'M:\\Media\\Programmes\\Painted Trail\\PAINTED TRAIL_ORG-EP255.mp4', title: 'Painted Trail - 255', color: '#9B9B9B', inFrames: 0, outFrames: s(1693.72), category: 'Program', star: '' },
        { file: 'M:\\Media\\Idents\\AURORA TV  Ident final.mp4', title: 'Ident_AURORA_27_May2022  - 0', color: '#f39e0b', inFrames: 0, outFrames: s(6.88), category: 'CH Ident', star: '' },
        { file: 'M:\\Media\\Idents\\2026\\160_Ident_Com_Aug_2026.mp4', title: '160_Ident_Com_Aug_2026 - 0', color: '#f39e0b', inFrames: 0, outFrames: s(24.8), category: 'Ident', star: '' },
        { file: 'M:\\Media\\Social\\Instagram.mp4', title: 'Instagram_Social - 0', color: '#d0021b', inFrames: 0, outFrames: s(7), category: 'Social', star: '' },
      ],
    });
    // The first four items of a sample day: a programme, two idents (one title keeps its trailing space) and a social clip
    expect(file).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<PBPlaylist   id="10000000000042" name="aurora_media_2026_10_15.xml - 06:00:00:00">',
        '  <ITEM type="video_clip" file="M:\\Media\\Programmes\\Painted Trail\\PAINTED TRAIL_ORG-EP255.mp4" id="1001" inp="0" outp="1693.72" duration="1693.72" title="Painted Trail - 255" color="$9b9b9b" category="Program" star="" notes="" />',
        '  <ITEM type="video_clip" file="M:\\Media\\Idents\\AURORA TV  Ident final.mp4" id="1002" inp="0" outp="6.88" duration="6.88" title="Ident_AURORA_27_May2022 " color="$f39e0b" category="CH Ident" star="" notes="" />',
        '  <ITEM type="video_clip" file="M:\\Media\\Idents\\2026\\160_Ident_Com_Aug_2026.mp4" id="1003" inp="0" outp="24.8" duration="24.8" title="160_Ident_Com_Aug_2026" color="$f39e0b" category="Ident" star="" notes="" />',
        '  <ITEM type="video_clip" file="M:\\Media\\Social\\Instagram.mp4" id="1004" inp="0" outp="7" duration="7" title="Instagram_Social" color="$d0021b" category="Social" star="" notes="" />',
        '</PBPlaylist>',
        '',
      ].join('\n'),
    );
  });

  it('a programme part runs from its TC in; seconds keep at most two decimals', () => {
    const line = playoutXmlFile({ rootId: '1', name: 'x', firstItemId: 1, rate: r25, items: [{ file: 'f.mp4', title: 'Lumen Story - 1', color: null, inFrames: s(1200), outFrames: s(2700.4), category: '', star: 'NOVAMART' }] }).split('\n')[2];
    expect(line).toContain('inp="1200" outp="2700.4" duration="1500.4"');
    expect(line).toContain('color="" category="" star="NOVAMART"');
    expect(playoutXmlSeconds(0, r25)).toBe('0');
    expect(playoutXmlSeconds(1, r25)).toBe('0.04');
    expect(playoutXmlSeconds(2997, FRAME_RATES['29.97df'])).toBe('100');
    expect(playoutXmlSeconds(30, FRAME_RATES['29.97df'])).toBe('1');
  });

  it('escapes what XML needs; a line break in the notes stays', () => {
    const line = playoutXmlFile({ rootId: '1', name: 'x', firstItemId: 1, rate: r25, items: [{ file: 'M:\\A & B\\"c".mp4', title: 'Tom & <Jerry>', color: '#ABCDEF', inFrames: 0, outFrames: 25, category: 'Trailer\nNEWS', star: '' }] }).split('\n').slice(2, 4).join('\n');
    expect(line).toContain('file="M:\\A &amp; B\\&quot;c&quot;.mp4"');
    expect(line).toContain('title="Tom &amp; &lt;Jerry&gt;"');
    expect(line).toContain('color="$abcdef" category="Trailer\nNEWS"');
  });

  it('titles, colours, prefixes, ids and what is left out', () => {
    expect(playoutXmlTitle('Painted Trail - 0')).toBe('Painted Trail');
    expect(playoutXmlTitle('Painted Trail - 10')).toBe('Painted Trail - 10');
    expect(playoutXmlColor('red')).toBe('');
    expect(playoutXmlPrefix('AURORA-MEDIA')).toBe('aurora_media');
    expect(playoutXmlFirstItemId('2026-10-15')).toBe(24_790_001);
    expect(playoutXmlFirstItemId('2026-10-16') - playoutXmlFirstItemId('2026-10-15')).toBe(10_000);
    expect([...PLAYOUT_XML_LEFT_OUT]).toEqual(['linked-break', 'gap-compensator', 'note']);
  });
});
