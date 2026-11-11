import { useCrewStore } from '../../store/useCrewStore';
import { crewColor } from '../../config/theme';

/** A sender's crew colour (their chosen one, else their palette colour). */
export function useSenderColor(nodeId: number): string {
  const chosen = useCrewStore(s => s.crewMembers[nodeId]?.color);
  return crewColor(nodeId, chosen);
}
