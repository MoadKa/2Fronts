import './ProgressBar.css'

interface ProgressBarProps {
  // 0..1 fill ratio.
  ratio: number
  // Optional visible step label, e.g. "Step 3 of 5". Omitted on bookend screens.
  label?: string
  // Numbers for the ARIA range, so the bar is announced as "3 of 5".
  current?: number
  total?: number
}

// A minimal, reusable step progress bar (#26). No existing progress component in
// the repo, so this is the first. Purely presentational: the wizard computes the
// ratio/label and passes them in.
export function ProgressBar({ ratio, label, current, total }: ProgressBarProps) {
  // Scale, not width: the fill is drawn full-width and squeezed, so the step
  // change animates on the compositor instead of re-laying-out the track.
  const filled = Math.max(0, Math.min(1, ratio))
  return (
    <div className="progress">
      {label && <div className="progress-label">{label}</div>}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
      >
        <div className="progress-fill" style={{ transform: `scaleX(${filled})` }} />
      </div>
    </div>
  )
}
