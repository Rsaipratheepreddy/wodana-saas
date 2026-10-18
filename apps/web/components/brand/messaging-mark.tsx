/** A small, crisp two-tone messaging mark, usable at navigation and empty-state sizes. */
export function MessagingMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="11" fill="#F9E6AA" />
    <path d="M8 9.5h16v11H16l-5 4v-4H8z" fill="white" stroke="#82632B" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 13.5h8M12 17h5" stroke="#82632B" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}
