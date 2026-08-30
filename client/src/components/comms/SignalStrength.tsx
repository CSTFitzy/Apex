import { QUALITY_COLORS } from '../../utils/comms';
import type { LinkQuality } from '../../types';

interface Props {
  link: LinkQuality | null;
  compact?: boolean;
}

/**
 * 1-5 bar signal strength indicator, coloured by voice quality
 * (green -> yellow -> red) with the contributing factors in the tooltip.
 */
export default function SignalStrength({ link, compact = false }: Props) {
  const bars = link?.bars ?? 0;
  const quality = link?.quality ?? 'LOST';
  const color = QUALITY_COLORS[quality];
  const title = link ? `${quality} - ${link.snrDb} dB SNR. ${link.factors.join('. ')}` : 'No link data';

  return (
    <span className="signal-strength" title={title}>
      <span className="signal-bars" aria-label={`Signal strength ${bars} of 5`}>
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className="signal-bar"
            style={{
              height: `${level * 3 + 3}px`,
              backgroundColor: level <= bars ? color : 'rgba(255,255,255,0.18)',
            }}
          />
        ))}
      </span>
      {!compact && (
        <span className="signal-label" style={{ color }}>
          {quality}
        </span>
      )}
    </span>
  );
}
