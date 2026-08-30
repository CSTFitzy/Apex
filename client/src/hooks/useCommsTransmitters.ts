import { useMemo } from 'react';
import { useCommsStore } from '../store/commsStore';
import { QUALITY_COLORS } from '../utils/comms';
import type { CommsTransmitter } from '../components/TacticalMap';
import type { TacticalUnit } from '../types';

/** Nominal coverage radius per signal bar, in metres. */
const COVERAGE_PER_BAR_M = 3000;
const DEFAULT_COVERAGE_M = 9000;

/**
 * Derives the on-map communications overlay: every station currently keying a
 * radio net, with a coverage circle sized from the measured link quality.
 */
export function useCommsTransmitters(units: TacticalUnit[]): CommsTransmitter[] {
  const channels = useCommsStore((state) => state.channels);
  const link = useCommsStore((state) => state.link);

  return useMemo(() => {
    const result: CommsTransmitter[] = [];
    for (const channel of channels) {
      if (!channel.activeSpeakerId) continue;
      const speaker = channel.members.find((m) => m.unitId === channel.activeSpeakerId);
      if (!speaker) continue;
      const unit = units.find((u) => u.id === speaker.unitId);
      if (!unit) continue;
      const coverageM = link
        ? Math.max(COVERAGE_PER_BAR_M, link.bars * COVERAGE_PER_BAR_M)
        : DEFAULT_COVERAGE_M;
      result.push({
        unitId: unit.id,
        callsign: speaker.callsign,
        position: unit.position,
        coverageM,
        color: link ? QUALITY_COLORS[link.quality] : '#00d1ff',
        channelName: channel.name,
      });
    }
    return result;
  }, [channels, link, units]);
}
