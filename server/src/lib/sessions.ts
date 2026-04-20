export function officeDayCutoff(now: Date, officeDays: number): Date {
  // Cutoff = start-of-day of the weekday exactly `officeDays` weekdays before `now`.
  // The window is [cutoff, now], which includes `now`'s own date.
  const d = new Date(now);
  let remaining = officeDays;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}
