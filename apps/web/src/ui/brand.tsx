// The product's name and mark, kept in this one place: "9eye" is a codename until the brand is chosen.

export const PRODUCT_NAME = '9eye';

/** The product mark: a lens in a rounded square, in text colour, with the name beside it. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-section font-semibold tracking-[-0.02em] text-text">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect width="24" height="24" rx="7" fill="currentColor" />
        <circle cx="12" cy="12" r="5.75" fill="none" stroke="var(--surface)" strokeWidth="2.25" />
        <circle cx="12" cy="12" r="2" fill="var(--surface)" />
      </svg>
      {PRODUCT_NAME}
    </span>
  );
}
