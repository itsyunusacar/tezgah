// Small line icons (1.5px strokes) and the Tezgah mark.

type P = { size?: number }
const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const Plus = ({ size = 14 }: P) => svg(size, <path d="M8 3v10M3 8h10" />)
export const Folder = ({ size = 15 }: P) => svg(size, <path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z" />)
export const Clock = ({ size = 15 }: P) => svg(size, <><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3l2 1.5" /></>)
export const Gear = ({ size = 15 }: P) => svg(size, <><circle cx="8" cy="8" r="2" /><path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1" /></>)
export const Diff = ({ size = 15 }: P) => svg(size, <path d="M8 2.5v6M5 5.5h6M5 12.5h6" />)
export const SplitRow = ({ size = 15 }: P) => svg(size, <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M8 3v10" /></>)
export const SplitCol = ({ size = 15 }: P) => svg(size, <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 8h12" /></>)
export const Branch = ({ size = 12 }: P) => svg(size, <><circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="5.5" r="1.5" /><path d="M5 5v6M11 7c0 2.5-6 2-6 4" /></>)
export const Chevron = ({ size = 10 }: P) => svg(size, <path d="M4 6l4 4 4-4" />)
export const Close = ({ size = 12 }: P) => svg(size, <path d="M4 4l8 8M12 4l-8 8" />)
export const Refresh = ({ size = 14 }: P) => svg(size, <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />)
export const Search = ({ size = 15 }: P) => svg(size, <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>)
export const Note = ({ size = 13 }: P) => svg(size, <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />)
export const Globe = ({ size = 15 }: P) => svg(size, <><circle cx="8" cy="8" r="5.75" /><path d="M2.25 8h11.5M8 2.25c1.6 1.7 2.4 3.6 2.4 5.75S9.6 12.05 8 13.75C6.4 12.05 5.6 10.15 5.6 8S6.4 3.95 8 2.25z" /></>)
export const Bell = ({ size = 15 }: P) => svg(size, <><path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1.25H3z" /><path d="M6.75 14.25a1.4 1.4 0 0 0 2.5 0" /></>)
export const Pin = ({ size = 12 }: P) => svg(size, <><path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5z" /><path d="M8 9v4.5" /></>)
export const Sidebar = ({ size = 15 }: P) => svg(size, <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M6 3v10" /></>)

/** The Tezgah mark: a bench with a cursor block on it. Legs flow into the top through small fillets. */
export function Mark({ size = 18 }: P) {
  const f = 3
  const k = 0.552
  const fillet = (x: number, dir: number) =>
    `M${x + dir * f} 57 C${x + dir * f * (1 - k)} 57 ${x} ${57 + f * (1 - k)} ${x} ${57 + f} L${x} 57 Z`
  return (
    <svg width={size} height={(size * 58) / 68} viewBox="16 23 68 58" fill="currentColor" aria-label="Tezgah">
      <rect x="16" y="45" width="68" height="12" rx="3" />
      <rect x="25" y="50" width="10" height="31" rx="2" />
      <rect x="65" y="50" width="10" height="31" rx="2" />
      <rect x="27" y="23" width="13" height="18" rx="2" />
      <path d={[fillet(25, -1), fillet(35, 1), fillet(65, -1), fillet(75, 1)].join(' ')} />
    </svg>
  )
}
