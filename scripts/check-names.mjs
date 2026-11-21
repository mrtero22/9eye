// Fails when a tracked file — its contents or its path — holds the name of a real customer or of a
// third-party product the repository must not name (CLAUDE.md, user 2026-11-17: made-up names only).
// The patterns are kept encoded here, so that this file does not hold the names either.
// A name counts even when letters, digits or "_" follow it (a channel code, a file name), and a
// short name in capitals counts after any non-capital (an escaped "\n" in a string, say).
// Run: npm run check:names (it also runs first in npm test).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMES = [
  ['KD88IVthLXpdKWdlbSg/IWluaSk=', 'i'],
  ['KD88IVtBLVpdKUdFTSg/IUlOSSk=', ''],
  ['KD88IVthLXpdKXZzbg==', 'i'],
  ['KD88IVtBLVpdKVZTTg==', ''],
  ['KD88IVthLXpdKXgtP3BlcnQ=', 'i'],
  ['cml2ZXIgP3BsdXM=', 'i'],
  ['KD88IVthLXpdKXJ1Yml4', 'i'],
  ['KD88IVthLXpdKWJvbGx5d29vZA==', 'i'],
  ['KD88IVthLXpdKWVsZ2Fkbw==', 'i'],
  ['KD88IVthLXpdKW1pZmE=', 'i'],
  ['KD88IVthLXpdKW9ueXg=', 'i'],
  ['KD88IVthLXpdKW5hcmNvcw==', 'i'],
  ['YmVuIGxlbWFu', 'i'],
  ['c2FoaXBzaXo=', 'i'],
  ['cmVmZXJlbmNlWyAtXT9zeXN0ZW0=', 'i'],
  ['cHJpdmF0ZSAocmVmZXJlbmNlfGltcG9ydCk=', 'i'],
].map(([b, flags]) => new RegExp(Buffer.from(b, 'base64').toString('utf8'), flags));

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (NAMES.some((re) => re.test(file))) hits.push(`${file}: the file name`);
  if (text.includes(0)) continue; // binary
  const lines = text.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*"integrity": "sha\d+-/.test(line)) return; // package hashes: random letters, never a name
    if (NAMES.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (hits.length) {
  console.error(`check:names — ${hits.length} line(s) hold a name the repository must not hold (use the made-up names, see CLAUDE.md):`);
  for (const h of hits.slice(0, 200)) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check:names — ${files.length} files, no real customer or product names.`);
