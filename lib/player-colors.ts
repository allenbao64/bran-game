/** One colour per seat, assigned by join order so every browser agrees. */
export const PLAYER_COLORS = ["#d4553a", "#2f78c4", "#e0a526"] as const;

export function playerColor(playerIds: string[], playerId: string) {
  const index = playerIds.indexOf(playerId);
  return index < 0 ? "#9aa29b" : PLAYER_COLORS[index % PLAYER_COLORS.length];
}
