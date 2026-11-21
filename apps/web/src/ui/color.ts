// Data colours: colours that come from the customer's data (block types, content types).
// The only colours a page may use outside the tokens — always through these helpers.

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function safeColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : 'var(--text-3)';
}

/** The data colour mixed into the surface (16 % for a block fill, 50 % for its border). */
export function dataTint(color: string | null | undefined, percent: number): string {
  return `color-mix(in srgb, ${safeColor(color)} ${percent}%, var(--surface))`;
}
