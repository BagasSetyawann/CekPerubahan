import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { q, pool, init, hashPassword, checkPassword } from './db.js';
import { FREQ, today, isDate, fmtDate, periodOf, evaluate } from './periods.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const fail = (status, message, field) => Object.assign(new Error(message), { status, field });
const num = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw fail(404, 'Data tidak ditemukan'); return n; };
const yearOf = (v) => { const y = Number(v || today().slice(0, 4)); if (!Number.isInteger(y) || y < 2000 || y > 2100) throw fail(400, 'Tahun tidak valid'); return y; };

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-ancestors 'none'",
  });
  // Permintaan pengubah data hanya boleh dari halaman aplikasi ini sendiri.
  if (req.method !== 'GET' && req.headers.origin) {
    let host = null;
    try { host = new URL(req.headers.origin).host; } catch {}
    if (host !== req.headers.host) return res.status(403).json({ error: 'Asal permintaan tidak dikenal' });
  }
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

// ---------- Masuk / keluar ----------
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const failures = new Map(); // shortcut: hitungan gagal masuk di memori, hilang saat server restart; cukup untuk satu instans

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${username}`;
  const f = failures.get(key);
  if (f?.until > Date.now()) throw fail(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
  const { rows } = await q('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  if (!rows[0] || !checkPassword(password, rows[0].password_hash)) {
    const n = f && !f.until ? f.n + 1 : 1;
    failures.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60e3 : 0 });
    throw fail(401, 'Nama pengguna atau kata sandi salah');
  }
  failures.delete(key);
  const token = randomBytes(32).toString('hex');
  await q('DELETE FROM sessions WHERE expires_at < now()');
  await q("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [token, rows[0].id]);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5, path: '/' });
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  await q('DELETE FROM sessions WHERE token = $1', [cookies(req).sid || '']);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.use('/api', async (req, res, next) => {
  const token = cookies(req).sid;
  const { rows } = token
    ? await q('SELECT u.id, u.username, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()', [token])
    : { rows: [] };
  if (!rows[0]) throw fail(401, 'Silakan masuk terlebih dahulu');
  req.user = rows[0];
  next();
});

app.get('/api/me', (req, res) => res.json(req.user));

// ---------- Data per tahun ----------
async function loadYear(year) {
  const range = [`${year}-01-01`, `${year}-12-31`];
  const [acts, chks, hols] = await Promise.all([
    q('SELECT * FROM activities ORDER BY id'),
    q(`SELECT c.id, c.activity_id, c.done_date, c.note, c.created_at,
              (c.created_at AT TIME ZONE 'Asia/Makassar')::date AS recorded_on, u.name AS user_name,
              COALESCE(json_agg(json_build_object('id', f.id, 'filename', f.filename, 'size', f.size) ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL), '[]') AS files
         FROM checks c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN attachments f ON f.check_id = c.id
        WHERE c.done_date BETWEEN $1 AND $2
        GROUP BY c.id, u.name ORDER BY c.done_date, c.id`, range),
    q('SELECT date, name FROM holidays WHERE date BETWEEN $1 AND $2 ORDER BY date', range),
  ]);
  const holidaySet = new Set(hols.rows.map((h) => h.date));
  const now = today();
  const activities = acts.rows.map((a) => {
    const checks = chks.rows.filter((c) => c.activity_id === a.id);
    return { ...a, freqLabel: FREQ[a.frequency], checks, ...evaluate(a, checks, year, now, holidaySet) };
  });
  return { year, today: now, activities, holidays: hols.rows };
}

app.get('/api/dashboard', async (req, res) => {
  const now = today();
  // shortcut: dasbor hanya melihat tahun berjalan; periode terlewat tahun lalu dilihat di Laporan.
  const data = await loadYear(Number(now.slice(0, 4)));
  const items = data.activities.map((a) => {
    const base = { id: a.id, name: a.name, frequency: a.frequency, freqLabel: a.freqLabel, target: a.target, start_date: a.start_date, pct: a.pct, missed: a.missed, count: a.count };
    if (a.frequency === 'kondisional') return base;
    const current = a.periods.find((p) => p.key === periodOf(a.frequency, now).key) || null;
    const offDay = a.frequency === 'harian' && !current && now >= a.start_date
      ? data.holidays.find((h) => h.date === now)?.name || 'Akhir pekan' : null;
    const missedList = a.periods.filter((p) => p.status === 'terlewat').slice(-3).reverse().map((p) => ({ start: p.start, label: p.label }));
    return { ...base, current, offDay, missedList };
  });
  const done = data.activities.reduce((s, a) => s + a.done, 0);
  const due = data.activities.reduce((s, a) => s + a.due, 0);
  res.json({ today: now, user: req.user, items, done, due, pct: due ? Math.round((done / due) * 100) : null });
});

// ---------- Kegiatan ----------
function activityInput(b = {}) {
  const name = String(b.name || '').trim();
  if (!name) throw fail(400, 'Isi nama kegiatan', 'name');
  const frequency = String(b.frequency || '');
  if (!FREQ[frequency]) throw fail(400, 'Pilih periode kegiatan', 'frequency');
  const target = Number(b.target || 1);
  if (!Number.isInteger(target) || target < 1 || target > 50) throw fail(400, 'Isi target dengan angka 1 sampai 50', 'target');
  const start = String(b.start_date || '');
  if (!isDate(start)) throw fail(400, 'Isi tanggal mulai berlaku', 'start_date');
  const text = (k) => String(b[k] || '').trim().slice(0, 5000);
  return [name.slice(0, 300), frequency, frequency === 'harian' ? 1 : target, start, text('description'), text('plan'), text('output'), text('outcome')];
}

app.get('/api/activities', async (req, res) => {
  res.json((await q('SELECT * FROM activities ORDER BY id')).rows.map((a) => ({ ...a, freqLabel: FREQ[a.frequency] })));
});

app.get('/api/activities/:id', async (req, res) => {
  const id = num(req.params.id);
  const data = await loadYear(yearOf(req.query.year));
  const activity = data.activities.find((a) => a.id === id);
  if (!activity) throw fail(404, 'Kegiatan tidak ditemukan');
  res.json({ year: data.year, today: data.today, holidays: data.holidays, activity });
});

app.post('/api/activities', async (req, res) => {
  const { rows } = await q('INSERT INTO activities (name, frequency, target, start_date, description, plan, output, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', activityInput(req.body));
  res.json(rows[0]);
});

app.put('/api/activities/:id', async (req, res) => {
  const { rowCount } = await q('UPDATE activities SET name=$1, frequency=$2, target=$3, start_date=$4, description=$5, plan=$6, output=$7, outcome=$8 WHERE id=$9', [...activityInput(req.body), num(req.params.id)]);
  if (!rowCount) throw fail(404, 'Kegiatan tidak ditemukan');
  res.json({ ok: true });
});

app.delete('/api/activities/:id', async (req, res) => {
  await q('DELETE FROM activities WHERE id = $1', [num(req.params.id)]);
  res.json({ ok: true });
});

// ---------- Ceklis ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 }, defParamCharset: 'utf8' });
// Jenis berkas dicek dari isinya, bukan dari nama atau keterangan browser.
const sniff = (b) =>
  b.subarray(0, 4).toString('latin1') === '%PDF' ? 'application/pdf'
  : b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png'
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : null;

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

async function checkInput(req, activity, checkId = 0) {
  const date = String(req.body.done_date || '');
  if (!isDate(date)) throw fail(400, 'Isi tanggal pelaksanaan', 'done_date');
  if (date > today()) throw fail(400, 'Tanggal pelaksanaan tidak boleh melewati hari ini', 'done_date');
  if (date < activity.start_date) throw fail(400, `Kegiatan ini baru berlaku mulai ${fmtDate(activity.start_date)}`, 'done_date');
  if (activity.frequency === 'harian' && (await q('SELECT 1 FROM checks WHERE activity_id=$1 AND done_date=$2 AND id<>$3', [activity.id, date, checkId])).rowCount)
    throw fail(409, `Tanggal ${fmtDate(date)} sudah diceklis`, 'done_date');
  const files = (req.files || []).map((f) => {
    const mime = sniff(f.buffer);
    if (!mime) throw fail(400, `${f.originalname} bukan berkas PDF, JPG, atau PNG`, 'files');
    return { name: f.originalname.slice(0, 200), mime, buffer: f.buffer };
  });
  return { date, note: String(req.body.note || '').trim().slice(0, 2000), files };
}

const saveFiles = (c, checkId, files) => Promise.all(files.map((f) =>
  c.query('INSERT INTO attachments (check_id, filename, mime, size, data) VALUES ($1,$2,$3,$4,$5)', [checkId, f.name, f.mime, f.buffer.length, f.buffer])));

app.post('/api/checks', upload.array('files'), async (req, res) => {
  const activity = (await q('SELECT * FROM activities WHERE id = $1', [num(req.body.activity_id)])).rows[0];
  if (!activity) throw fail(404, 'Kegiatan tidak ditemukan');
  const input = await checkInput(req, activity);
  const id = await tx(async (c) => {
    const { rows } = await c.query('INSERT INTO checks (activity_id, done_date, note, user_id) VALUES ($1,$2,$3,$4) RETURNING id', [activity.id, input.date, input.note, req.user.id]);
    await saveFiles(c, rows[0].id, input.files);
    return rows[0].id;
  });
  res.json({ id });
});

app.put('/api/checks/:id', upload.array('files'), async (req, res) => {
  const id = num(req.params.id);
  const activity = (await q('SELECT a.* FROM checks c JOIN activities a ON a.id = c.activity_id WHERE c.id = $1', [id])).rows[0];
  if (!activity) throw fail(404, 'Ceklis tidak ditemukan');
  const input = await checkInput(req, activity, id);
  const remove = [req.body.remove ?? []].flat().map(Number).filter(Number.isInteger);
  await tx(async (c) => {
    await c.query('UPDATE checks SET done_date=$1, note=$2, updated_at=now() WHERE id=$3', [input.date, input.note, id]);
    if (remove.length) await c.query('DELETE FROM attachments WHERE check_id=$1 AND id = ANY($2)', [id, remove]);
    await saveFiles(c, id, input.files);
  });
  res.json({ ok: true });
});

app.delete('/api/checks/:id', async (req, res) => {
  await q('DELETE FROM checks WHERE id = $1', [num(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/files/:id', async (req, res) => {
  const f = (await q('SELECT filename, mime, data FROM attachments WHERE id = $1', [num(req.params.id)])).rows[0];
  if (!f) throw fail(404, 'Lampiran tidak ditemukan');
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'Cache-Control': 'private, max-age=3600' });
  res.send(f.data);
});

// ---------- Hari libur ----------
app.get('/api/holidays', async (req, res) => {
  const y = yearOf(req.query.year);
  res.json((await q('SELECT date, name FROM holidays WHERE date BETWEEN $1 AND $2 ORDER BY date', [`${y}-01-01`, `${y}-12-31`])).rows);
});

app.post('/api/holidays', async (req, res) => {
  const date = String(req.body?.date || '');
  const name = String(req.body?.name || '').trim().slice(0, 200);
  if (!isDate(date)) throw fail(400, 'Isi tanggal hari libur', 'date');
  if (!name) throw fail(400, 'Isi keterangan hari libur', 'name');
  await q('INSERT INTO holidays (date, name) VALUES ($1,$2) ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name', [date, name]);
  res.json({ ok: true });
});

app.delete('/api/holidays/:date', async (req, res) => {
  if (!isDate(req.params.date)) throw fail(404, 'Hari libur tidak ditemukan');
  await q('DELETE FROM holidays WHERE date = $1', [req.params.date]);
  res.json({ ok: true });
});

// ---------- Pengguna (semua pengguna punya hak yang sama) ----------
const passwordOf = (b) => { const p = String(b?.password || ''); if (p.length < 8) throw fail(400, 'Kata sandi minimal 8 karakter', 'password'); return p; };

app.get('/api/users', async (req, res) => {
  res.json((await q('SELECT id, username, name, created_at FROM users ORDER BY name')).rows);
});

app.post('/api/users', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw fail(400, 'Nama pengguna 3–30 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung', 'username');
  if (!name) throw fail(400, 'Isi nama lengkap', 'name');
  const password = passwordOf(req.body);
  if ((await q('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) throw fail(409, 'Nama pengguna sudah dipakai', 'username');
  await q('INSERT INTO users (username, name, password_hash) VALUES ($1,$2,$3)', [username, name, hashPassword(password)]);
  res.json({ ok: true });
});

app.put('/api/users/:id/password', async (req, res) => {
  const id = num(req.params.id);
  const { rowCount } = await q('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(passwordOf(req.body)), id]);
  if (!rowCount) throw fail(404, 'Pengguna tidak ditemukan');
  await q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [id, cookies(req).sid]); // sesi lain wajib masuk ulang
  res.json({ ok: true });
});

app.delete('/api/users/:id', async (req, res) => {
  const id = num(req.params.id);
  if (id === req.user.id) throw fail(400, 'Akun yang sedang dipakai tidak bisa dihapus');
  await q('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ---------- Laporan ----------
const STATUS = { selesai: 'Selesai', terlewat: 'Terlewat', berjalan: 'Berjalan', akan: '', kosong: '', info: '' };

function reportRows(data) {
  return data.activities.map((a) => {
    let cells;
    if (a.frequency === 'kondisional') cells = [{ from: 1, to: 12, status: 'info', text: `${a.count} kali dicatat` }];
    else if (a.frequency === 'harian') {
      cells = [];
      for (let m = 1; m <= 12; m++) {
        const ps = a.periods.filter((p) => Number(p.start.slice(5, 7)) === m);
        if (!ps.length) continue;
        const done = ps.filter((p) => p.status === 'selesai').length;
        const missed = ps.filter((p) => p.status === 'terlewat').length;
        const started = ps.some((p) => p.status !== 'akan');
        const status = !started ? 'akan' : missed ? 'terlewat' : done === ps.length ? 'selesai' : 'berjalan';
        cells.push({ from: m, to: m, status, text: started ? `${done}/${ps.length}` : '' });
      }
    } else cells = a.periods.map((p) => ({ from: Number(p.start.slice(5, 7)), to: Number(p.end.slice(5, 7)), status: p.status, late: p.late, text: a.target > 1 && p.status !== 'akan' ? `${p.count}/${p.target}` : '' }));
    // Bulan sebelum kegiatan mulai berlaku diisi sel kosong.
    const filled = [];
    let m = 1;
    for (const c of cells) {
      if (c.from > m) filled.push({ from: m, to: c.from - 1, status: 'kosong', text: '' });
      filled.push(c);
      m = c.to + 1;
    }
    if (m <= 12) filled.push({ from: m, to: 12, status: 'kosong', text: '' });
    return { id: a.id, name: a.name, frequency: a.frequency, freqLabel: a.freqLabel, target: a.target, done: a.done, due: a.due, missed: a.missed, pct: a.pct, count: a.count, cells: filled };
  });
}

app.get('/api/report', async (req, res) => {
  const data = await loadYear(yearOf(req.query.year));
  res.json({ year: data.year, today: data.today, rows: reportRows(data) });
});

app.get('/api/calendar', async (req, res) => {
  res.json(await loadYear(yearOf(req.query.year)));
});

app.get('/api/report.xlsx', async (req, res) => {
  const data = await loadYear(yearOf(req.query.year));
  const rows = reportRows(data);
  const wb = new ExcelJS.Workbook();
  const fill = { selesai: 'FFD7EFE0', terlewat: 'FFFBD9D5', berjalan: 'FFFFEFC7' };
  const head = (ws, cols) => { const r = ws.addRow(cols); r.font = { bold: true }; r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EAE6' } }; c.border = { bottom: { style: 'thin' } }; }); };

  const ws = wb.addWorksheet('Kepatuhan');
  ws.addRow([`Rekap Kepatuhan Program Manajemen Perubahan Tahun ${data.year}`]).font = { bold: true, size: 14 };
  ws.addRow([`BPS Kabupaten Parigi Moutong · keadaan ${fmtDate(data.today)}`]);
  ws.addRow([]);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  head(ws, ['No', 'Program', 'Periode', 'Target per periode', 'Selesai', 'Wajib s.d. hari ini', 'Terlewat', 'Kepatuhan (%)', ...months]);
  rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, r.name, r.freqLabel, r.frequency === 'kondisional' ? '-' : r.target, r.done, r.due, r.missed, r.pct ?? '-']);
    for (const c of r.cells) {
      const col = 8 + c.from;
      const cell = row.getCell(col);
      cell.value = [STATUS[c.status], c.text, c.late ? '(terlambat dicatat)' : ''].filter(Boolean).join(' ');
      if (fill[c.status]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill[c.status] } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      if (c.to > c.from) ws.mergeCells(row.number, col, row.number, 8 + c.to);
    }
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  });
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 46 : i < 8 ? 12 : 11; });

  const wr = wb.addWorksheet('Riwayat');
  head(wr, ['No', 'Program', 'Tanggal pelaksanaan', 'Periode', 'Catatan', 'Lampiran', 'Dicatat oleh', 'Dicatat pada', 'Keterangan']);
  let n = 0;
  for (const a of data.activities)
    for (const c of a.checks) {
      const p = a.frequency === 'kondisional' ? null : periodOf(a.frequency, c.done_date);
      wr.addRow([++n, a.name, fmtDate(c.done_date), p?.label || 'Kondisional', c.note, c.files.map((f) => f.filename).join(', '), c.user_name || '(pengguna dihapus)',
        new Date(c.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }) + ' WITA', p && c.recorded_on > p.end ? 'Terlambat dicatat' : '']);
    }
  wr.columns.forEach((c, i) => { c.width = [6, 40, 20, 22, 50, 30, 22, 24, 18][i]; c.alignment = { wrapText: true, vertical: 'top' }; });

  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Kepatuhan-Manajemen-Perubahan-${data.year}.xlsx"` });
  await wb.xlsx.write(res);
  res.end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Alamat tidak ditemukan' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran tiap lampiran maksimal 5 MB' : 'Lampiran maksimal 10 berkas sekali simpan', field: 'files' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, field: err.field });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi.' });
});

await init();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Aplikasi berjalan di http://localhost:${port}`));
