// Who receives broadcast emails (ticket published, win announcements):
// active members with notifications enabled — nobody else. Pure, unit-tested.

export function selectBroadcastAudience(members) {
  return members.filter((m) => m.is_active && m.notifications_enabled);
}
