export const NZ_TZ = 'Pacific/Auckland';

export const formatTime = (date: Date): string => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

export const toNZDateKey = (date: Date): string => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

export const getNZMonthYear = (date: Date): string => {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: NZ_TZ, month: 'long', year: 'numeric' }).format(date);
};

export const getWeekRange = (dateKey: string): { start: string; end: string } => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: toNZDateKey(monday), end: toNZDateKey(sunday) };
};

export const getWeekDays = (dateKey: string): string[] => {
  const { start } = getWeekRange(dateKey);
  const [y, m, d] = start.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(mon);
    day.setDate(day.getDate() + i);
    return toNZDateKey(day);
  });
};

/** 'yyyy-mm-dd' → 'dd/mm/yyyy'. */
export const formatDateKey = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

/** 'HH:mm' → '6:30 pm'. */
export const formatClock = (time: string): string => {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
