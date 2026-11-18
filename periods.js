// Logika periode. Semua tanggal berupa string 'YYYY-MM-DD' supaya tidak ada geseran zona waktu.
export const FREQ = {
  harian: 'Harian',
  bulanan: 'Bulanan',
  triwulan: 'Triwulan',
  semester: 'Semester',
  tahunan: 'Tahunan',
  kondisional: 'Kondisional',
};
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ROMAWI = ['I', 'II', 'III', 'IV'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' }); // WITA
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);
export const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
export const isWorkday = (s, holidays) => { const w = new Date(s + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !holidays.has(s); };

export function periodOf(freq, date) {
  const [y, m] = date.split('-').map(Number);
  const span = (key, sm, em, label) => ({ key, start: ymd(y, sm, 1), end: ymd(y, em, lastDay(y, em)), label });
  if (freq === 'harian') return { key: date, start: date, end: date, label: fmtDate(date) };
  if (freq === 'bulanan') return span(`${y}-${pad(m)}`, m, m, `${BULAN[m - 1]} ${y}`);
  if (freq === 'triwulan') { const q = Math.ceil(m / 3); return span(`${y}-T${q}`, q * 3 - 2, q * 3, `Triwulan ${ROMAWI[q - 1]} ${y}`); }
  if (freq === 'semester') { const s = m <= 6 ? 1 : 2; return span(`${y}-S${s}`, s * 6 - 5, s * 6, `Semester ${ROMAWI[s - 1]} ${y}`); }
  return span(`${y}`, 1, 12, `Tahun ${y}`); // tahunan
}

export function periodsInYear(freq, year, holidays) {
  const out = [];
  if (freq === 'harian') {
    for (let m = 1; m <= 12; m++)
      for (let d = 1; d <= lastDay(year, m); d++) {
        const s = ymd(year, m, d);
        if (isWorkday(s, holidays)) out.push(periodOf('harian', s));
      }
    return out;
  }
  for (let m = 1; m <= 12; m++) {
    const p = periodOf(freq, ymd(year, m, 1));
    if (out.at(-1)?.key !== p.key) out.push(p);
  }
  return out;
}

// checks: [{ done_date, recorded_on }] milik satu kegiatan pada tahun tersebut.
export function evaluate(activity, checks, year, now, holidays) {
  if (activity.frequency === 'kondisional') return { periods: [], done: 0, due: 0, missed: 0, pct: null, count: checks.length };
  const target = activity.frequency === 'harian' ? 1 : activity.target;
  const periods = periodsInYear(activity.frequency, year, holidays)
    .filter((p) => p.end >= activity.start_date)
    .map((p) => {
      const inside = checks.filter((c) => c.done_date >= p.start && c.done_date <= p.end);
      const count = activity.frequency === 'harian' ? Math.min(inside.length, 1) : inside.length;
      const status = count >= target ? 'selesai' : p.end < now ? 'terlewat' : p.start <= now ? 'berjalan' : 'akan';
      // Terlambat: pelaksanaan ke-n (yang memenuhi target) baru dicatat setelah periodenya berakhir.
      const late = status === 'selesai' && inside.map((c) => c.recorded_on).sort()[target - 1] > p.end;
      return { ...p, count, target, status, late };
    });
  const done = periods.filter((p) => p.status === 'selesai').length;
  const missed = periods.filter((p) => p.status === 'terlewat').length;
  const due = done + missed;
  return { periods, done, due, missed, pct: due ? Math.round((done / due) * 100) : null, count: checks.length };
}
