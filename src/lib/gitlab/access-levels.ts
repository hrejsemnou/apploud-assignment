const ACCESS_LEVELS: Record<number, string> = {
  5: "Minimal Access",
  10: "Guest",
  15: "Planner",
  20: "Reporter",
  25: "Security Manager",
  30: "Developer",
  40: "Maintainer",
  50: "Owner",
};

export function accessLevelToString(level: number): string {
  return ACCESS_LEVELS[level] ?? "Unknown";
}