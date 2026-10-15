export function localDateKey(date: Date): string {
  return (
    String(date.getFullYear()).padStart(4, '0') +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}
export function dateInMonth(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}
export function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 9999) return false;
  return (
    localDateKey(
      dateInMonth(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ) === value
  );
}
