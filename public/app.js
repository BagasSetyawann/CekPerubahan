// Aplikasi satu halaman tanpa framework: rute di hash (#/...), data dari /api.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = $('main');

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const STATUS = { selesai: 'Selesai', terlewat: 'Terlewat', berjalan: 'Belum dicentang', akan: 'Belum dimulai' };
const FREQS = [['harian', 'Harian (hari kerja)'], ['bulanan', 'Bulanan'], ['triwulan', 'Triwulan'], ['semester', 'Semester'], ['tahunan', 'Tahunan'], ['kondisional', 'Kondisional (tanpa target)']];
const MAX_FILE = 5 * 1024 * 1024;

const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
const fmtLong = (s) => `${HARI[new Date(s + 'T00:00:00Z').getUTCDay()]}, ${fmtDate(s)}`;
const fmtTime = (iso) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WITA';
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const maxDate = (...d) => d.filter(Boolean).sort().at(-1);
const minDate = (...d) => d.filter(Boolean).sort()[0];
const tag = (status, text = STATUS[status]) => `<span class="tag tag--${status}">${esc(text)}</span>`;
const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);

class ApiError extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  const json = body && !(body instanceof FormData);
  const res = await fetch('/api' + path, { method, body: json ? JSON.stringify(body) : body, headers: json ? { 'Content-Type': 'application/json' } : {} });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/login') { showLogin(); throw new ApiError('Sesi berakhir. Silakan masuk lagi.'); }
  if (!res.ok) throw Object.assign(new ApiError(data?.error || 'Permintaan gagal. Coba lagi.'), { field: data?.field });
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('.toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------- Formulir ----------
const field = (id, label, control, hint = '') =>
  `<div class="field"><label for="${id}">${label}</label>${control}${hint ? `<p class="hint">${hint}</p>` : ''}<p class="field__error" id="${id}-err"></p></div>`;
const input = (id, name, attrs = '') => `<input id="${id}" name="${name}" aria-describedby="${id}-err" ${attrs}>`;

function showError(form, err) {
  $$('.field__error', form).forEach((e) => (e.textContent = ''));
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  $('.form__status', form).textContent = '';
  const el = err.field && form.elements[err.field];
  if (el?.id) {
    el.setAttribute('aria-invalid', 'true');
    $(`#${el.id}-err`, form).textContent = err.message;
    el.focus();
  } else $('.form__status', form).textContent = err.message;
}

function bindForm(form, onSubmit) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    try { await onSubmit(form); } catch (err) { if (err instanceof ApiError) showError(form, err); else throw err; } finally { btn.disabled = false; }
  });
}

function openDialog({ title, sub = '', body, submit, wide = false, extra = '', onSubmit }) {
  const d = document.createElement('dialog');
  d.className = 'dialog' + (wide ? ' dialog--wide' : '');
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `<form novalidate>
    <header><div><h2 id="dlg-title">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Tutup">×</button></header>
    <div class="dialog__body">${body}</div>
    <p class="form__status" role="status"></p>
    <footer>${extra}<span class="grow"></span><button type="button" class="btn btn--secondary" data-close>Batal</button><button type="submit" class="btn btn--primary">${esc(submit)}</button></footer>
  </form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  $$('[data-close]', d).forEach((b) => (b.onclick = () => d.close()));
  bindForm($('form', d), async (form) => { await onSubmit(form); d.close(); });
  d.showModal();
  return d;
}

// ---------- Ceklis (tambah / ubah) ----------
function checkDialog({ activity, check, date, min, max, periodLabel, after }) {
  const files = check?.files || [];
  const d = openDialog({
    title: check ? 'Ubah ceklis' : 'Centang pelaksanaan',
    sub: [activity.name, periodLabel].filter(Boolean).join(' · '),
    submit: 'Simpan ceklis',
    extra: check ? '<button type="button" class="btn-text danger" data-delete>Hapus ceklis</button>' : '',
    body:
      field('c-date', 'Tanggal pelaksanaan', input('c-date', 'done_date', `type="date" required value="${esc(check?.done_date || date)}" min="${esc(min)}" max="${esc(max)}"`)) +
      field('c-note', 'Catatan', `<textarea id="c-note" name="note" rows="3" maxlength="2000" aria-describedby="c-note-err">${esc(check?.note)}</textarea>`) +
      (files.length ? `<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="hint" style="margin-bottom:6px">Lampiran tersimpan (centang untuk menghapus)</legend>${files.map((f) =>
        `<label class="checkline"><input type="checkbox" name="remove" value="${f.id}"> <a href="/api/files/${f.id}" target="_blank" rel="noopener">${esc(f.filename)}</a></label>`).join('')}</fieldset>` : '') +
      field('c-files', check ? 'Tambah lampiran bukti' : 'Lampiran bukti', input('c-files', 'files', 'type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"'), 'PDF, JPG, atau PNG. Maksimal 5 MB per berkas.'),
    onSubmit: async (form) => {
      const picked = [...form.elements.files.files];
      const big = picked.find((f) => f.size > MAX_FILE);
      if (big) throw Object.assign(new ApiError(`${big.name} lebih dari 5 MB. Perkecil dulu berkasnya.`), { field: 'files' });
      const fd = new FormData(form);
      if (!picked.length) fd.delete('files');
      fd.append('activity_id', activity.id);
      await api(check ? `/checks/${check.id}` : '/checks', { method: check ? 'PUT' : 'POST', body: fd });
      toast(check ? 'Ceklis diperbarui' : 'Ceklis tersimpan');
      after();
    },
  });
  $('[data-delete]', d)?.addEventListener('click', async () => {
    if (!confirm(`Hapus ceklis tanggal ${fmtDate(check.done_date)} beserta lampirannya?`)) return;
    await api(`/checks/${check.id}`, { method: 'DELETE' });
    d.close();
    toast('Ceklis dihapus');
    after();
  });
}

// Membuka dialog ceklis untuk satu periode; tanggal dibatasi dalam periode dan tidak melewati hari ini.
function checkForPeriod(activity, p, today, after) {
  const min = maxDate(p?.start, activity.start_date);
  const max = minDate(p?.end, today);
  checkDialog({ activity, date: max, min, max, periodLabel: p?.label, after });
}

// ---------- Kegiatan (tambah / ubah) ----------
function activityDialog(a, after) {
  const d = openDialog({
    title: a ? 'Ubah kegiatan' : 'Tambah kegiatan',
    submit: 'Simpan kegiatan',
    wide: true,
    extra: a ? '<button type="button" class="btn-text danger" data-delete>Hapus kegiatan</button>' : '',
    body: `
      ${field('a-name', 'Nama program', input('a-name', 'name', `required maxlength="300" value="${esc(a?.name)}"`))}
      <div class="form-grid form-grid--2">
        ${field('a-freq', 'Periode', `<select id="a-freq" name="frequency" aria-describedby="a-freq-err">${FREQS.map(([v, l]) => `<option value="${v}" ${a?.frequency === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('a-target', 'Target per periode', input('a-target', 'target', `type="number" inputmode="numeric" min="1" max="50" value="${a?.target || 1}"`), 'Berapa kali minimal dilaksanakan dalam satu periode.')}
      </div>
      ${field('a-start', 'Mulai berlaku', input('a-start', 'start_date', `type="date" required value="${esc(a?.start_date || new Date().getFullYear() + '-01-01')}"`), 'Periode sebelum tanggal ini tidak dihitung.')}
      ${field('a-desc', 'Uraian program', `<textarea id="a-desc" name="description" rows="2">${esc(a?.description)}</textarea>`)}
      ${field('a-plan', 'Rencana kegiatan', `<textarea id="a-plan" name="plan" rows="3">${esc(a?.plan)}</textarea>`)}
      ${field('a-output', 'Output', `<textarea id="a-output" name="output" rows="2">${esc(a?.output)}</textarea>`)}
      ${field('a-outcome', 'Outcome', `<textarea id="a-outcome" name="outcome" rows="2">${esc(a?.outcome)}</textarea>`)}`,
    onSubmit: async (form) => {
      const body = Object.fromEntries(new FormData(form));
      body.target = Number(body.target || 1);
      const res = await api(a ? `/activities/${a.id}` : '/activities', { method: a ? 'PUT' : 'POST', body });
      toast('Kegiatan tersimpan');
      after(res?.id || a.id);
    },
  });
  const freq = $('#a-freq', d);
  const syncTarget = () => ($('#a-target', d).closest('.field').hidden = ['harian', 'kondisional'].includes(freq.value));
  freq.addEventListener('change', syncTarget);
  syncTarget();
  $('[data-delete]', d)?.addEventListener('click', async () => {
    if (!confirm(`Hapus "${a.name}"? Semua ceklis dan lampirannya ikut terhapus dan tidak bisa dikembalikan.`)) return;
    await api(`/activities/${a.id}`, { method: 'DELETE' });
    d.close();
    toast('Kegiatan dihapus');
    location.hash = '#/kegiatan';
  });
}

// ---------- Halaman: Dasbor ----------
async function viewDashboard() {
  const data = await api('/dashboard');
  const t = data.today;
  const periodic = data.items.filter((i) => i.frequency !== 'kondisional');
  const open = periodic.filter((i) => i.current && i.current.status !== 'selesai');
  const missed = periodic.filter((i) => i.missed > 0);
  const totalMissed = missed.reduce((s, i) => s + i.missed, 0);
  const conditional = data.items.filter((i) => i.frequency === 'kondisional');
  const year = t.slice(0, 4);

  const currentRow = (i) => {
    const p = i.current;
    let meta, action;
    if (!p) {
      meta = i.offDay ? `<span>Hari ini libur: ${esc(i.offDay)}</span>` : `<span>Mulai berlaku ${fmtDate(i.start_date)}</span>`;
      action = `<a class="btn btn--secondary" href="#/kegiatan/${i.id}">Lihat riwayat</a>`;
    } else {
      const left = daysBetween(t, p.end);
      meta = `${tag(p.status)}<span>${esc(p.label)}</span>${i.target > 1 ? `<span>${p.count} dari ${p.target} kali</span>` : ''}${p.status !== 'selesai' && i.frequency !== 'harian' ? `<span>${left === 0 ? 'Batas hari ini' : `Sisa ${left} hari`}</span>` : ''}`;
      action = p.status === 'selesai'
        ? `<a class="btn btn--secondary" href="#/kegiatan/${i.id}">Lihat riwayat</a>`
        : `<button class="btn btn--primary" type="button" data-check="${i.id}">Centang ${i.frequency === 'harian' ? 'hari ini' : 'pelaksanaan'}</button>`;
    }
    return `<div class="row"><div><a class="row__title" href="#/kegiatan/${i.id}">${esc(i.name)}</a><div class="row__meta"><span>${esc(i.freqLabel)}</span>${meta}</div></div>${action}</div>`;
  };

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Dasbor</h1><p>${fmtLong(t)}</p></div>
    </div>
    <section class="stats" aria-label="Ringkasan ${year}">
      <div class="stat"><p class="stat__label">Kepatuhan ${year}</p><p class="stat__value">${pct(data.pct)}<small>${data.done} dari ${data.due} periode</small></p><div class="bar" aria-hidden="true"><i style="width:${data.pct ?? 0}%"></i></div></div>
      <div class="stat"><p class="stat__label">Belum dicentang periode ini</p><p class="stat__value">${open.length}<small>dari ${periodic.length} kegiatan</small></p></div>
      <div class="stat"><p class="stat__label">Periode terlewat ${year}</p><p class="stat__value">${totalMissed}<small>di ${missed.length} kegiatan</small></p></div>
    </section>
    <section aria-labelledby="h-now">
      <div class="section-head"><h2 id="h-now">Periode berjalan</h2><p>Yang belum dicentang tampil di atas</p></div>
      <div class="list">${[...periodic].sort((a, b) => (a.current?.status === 'selesai') - (b.current?.status === 'selesai') || !a.current - !b.current).map(currentRow).join('')}</div>
    </section>
    <section aria-labelledby="h-missed">
      <div class="section-head"><h2 id="h-missed">Terlewat tahun ini</h2><p>Bisa diisi susulan; waktu pencatatan tetap terekam</p></div>
      <div class="list">${missed.length ? missed.map((i) => `<div class="row"><div><a class="row__title" href="#/kegiatan/${i.id}">${esc(i.name)}</a>
        <div class="row__meta">${tag('terlewat', `${i.missed} ${i.frequency === 'harian' ? 'hari kerja' : 'periode'}`)}<span>Terakhir: ${i.missedList.map((p) => esc(p.label)).join(', ')}</span></div></div>
        <a class="btn btn--secondary" href="#/kegiatan/${i.id}">Isi susulan</a></div>`).join('') : '<p class="empty">Tidak ada periode yang terlewat.</p>'}</div>
    </section>
    ${conditional.length ? `<section aria-labelledby="h-cond">
      <div class="section-head"><h2 id="h-cond">Kegiatan kondisional</h2><p>Dicatat saat terjadi, tidak dihitung dalam kepatuhan</p></div>
      <div class="list">${conditional.map((i) => `<div class="row"><div><a class="row__title" href="#/kegiatan/${i.id}">${esc(i.name)}</a><div class="row__meta"><span>${i.count} kali dicatat tahun ini</span></div></div>
        <button class="btn btn--secondary" type="button" data-check="${i.id}">Catat pelaksanaan</button></div>`).join('')}</div>
    </section>` : ''}`;

  $$('[data-check]', main).forEach((b) => b.addEventListener('click', () => {
    const i = data.items.find((x) => x.id === Number(b.dataset.check));
    checkForPeriod(i, i.current, t, render);
  }));
}

// ---------- Halaman: Daftar kegiatan ----------
async function viewActivities() {
  const data = await api('/dashboard');
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Kegiatan</h1><p>${data.items.length} program manajemen perubahan</p></div>
      <div class="btn-row"><button class="btn btn--primary" type="button" data-add>Tambah kegiatan</button></div>
    </div>
    <div class="cards">${data.items.map((i) => `
      <a class="card" href="#/kegiatan/${i.id}">
        <div class="row__meta" style="margin:0"><span class="tag">${esc(i.freqLabel)}${i.target > 1 && i.frequency !== 'harian' ? ` · ${i.target}×` : ''}</span>${i.current ? tag(i.current.status) : ''}</div>
        <h3>${esc(i.name)}</h3>
        ${i.frequency === 'kondisional'
          ? `<div class="card__foot"><span>${i.count} kali dicatat</span><span>Tanpa target</span></div>`
          : `<div><div class="card__foot"><span>Kepatuhan ${pct(i.pct)}</span><span>${i.missed ? `${i.missed} terlewat` : 'Tidak ada yang terlewat'}</span></div><div class="bar" aria-hidden="true"><i style="width:${i.pct ?? 0}%"></i></div></div>`}
      </a>`).join('')}</div>`;
  $('[data-add]', main).onclick = () => activityDialog(null, (id) => (location.hash = `#/kegiatan/${id}`));
}

// ---------- Halaman: Rincian kegiatan ----------
function yearSelect(current, today) {
  const now = Number(today.slice(0, 4));
  const years = [...new Set([2026, now - 1, now, now + 1, current])].filter((y) => y >= 2026).sort();
  return `<div class="field" style="min-width:120px"><label for="year">Tahun</label><select id="year">${years.map((y) => `<option ${y === current ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`;
}

function dailyCalendar(a, year, holidays, today) {
  const per = new Map(a.periods.map((p) => [p.start, p]));
  const hol = new Map(holidays.map((h) => [h.date, h.name]));
  let rows = '';
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    let cells = '';
    for (let d = 1; d <= 31; d++) {
      if (d > last) { cells += '<td></td>'; continue; }
      const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const p = per.get(date);
      if (p) {
        const label = `${fmtLong(date)}: ${STATUS[p.status]}${p.late ? ', dicatat terlambat' : ''}`;
        cells += `<td><button type="button" class="day s-${p.status}${p.late ? ' late' : ''}" data-date="${date}" title="${esc(label)}" aria-label="${esc(label)}" ${p.status === 'akan' ? 'disabled' : ''}></button></td>`;
      } else if (date < a.start_date) cells += '<td></td>';
      else {
        const why = hol.get(date) || HARI[new Date(date + 'T00:00:00Z').getUTCDay()];
        cells += `<td class="off" title="${esc(`${fmtDate(date)}: ${why}`)}"></td>`;
      }
    }
    rows += `<tr><th scope="row">${BLN[m - 1]}</th>${cells}</tr>`;
  }
  return `<div class="table-box" style="padding:12px"><div class="scroll"><table class="cal"><caption class="hint" style="text-align:left;caption-side:bottom;padding-top:8px">Klik kotak hari kerja untuk mencentang atau mengubah.</caption>
    <thead><tr><th></th>${Array.from({ length: 31 }, (_, i) => `<th scope="col">${i + 1}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend"><span><i class="s-selesai"></i>Selesai</span><span><i class="late"></i>Dicatat terlambat</span><span><i class="s-terlewat"></i>Terlewat</span><span><i class="s-berjalan"></i>Hari ini</span><span><i class="off"></i>Libur atau akhir pekan</span></div></div>`;
}

const periodTiles = (a) => `<div class="tiles">${a.periods.map((p, n) => `
  <button type="button" class="tile" data-period="${n}" ${p.status === 'akan' ? 'disabled' : ''}>
    <strong>${esc(p.label)}</strong>
    <span class="row__meta" style="margin:0">${tag(p.status)}${p.late ? '<span class="tag tag--late">Dicatat terlambat</span>' : ''}</span>
    <small>${p.target > 1 ? `${p.count} dari ${p.target} kali` : p.count ? `${p.count} kali dicatat` : p.status === 'akan' ? `Mulai ${fmtDate(p.start)}` : `Sampai ${fmtDate(p.end)}`}</small>
  </button>`).join('')}</div>`;

async function viewActivity(id, params) {
  const year = Number(params.get('tahun')) || undefined;
  const data = await api(`/activities/${id}${year ? `?year=${year}` : ''}`);
  const { activity: a, today: t, holidays } = data;
  const refresh = () => viewActivity(id, params);
  const isDaily = a.frequency === 'harian';
  const isCond = a.frequency === 'kondisional';
  const checks = [...a.checks].reverse();
  const late = (c) => {
    if (isCond) return false;
    const p = a.periods.find((x) => c.done_date >= x.start && c.done_date <= x.end);
    return p && c.recorded_on > p.end;
  };
  const curPeriod = a.periods.find((p) => p.start <= t && p.end >= t);
  const info = [['Uraian program', a.description], ['Rencana kegiatan', a.plan], ['Output', a.output], ['Outcome', a.outcome]].filter(([, v]) => v);

  main.innerHTML = `
    <div>
      <a class="back" href="#/kegiatan">← Semua kegiatan</a>
      <div class="page-head">
        <div>
          <h1>${esc(a.name)}</h1>
          <p>${esc(a.freqLabel)}${isDaily ? ' setiap hari kerja' : ''}${!isDaily && !isCond ? ` · minimal ${a.target} kali per periode` : ''} · berlaku sejak ${fmtDate(a.start_date)}</p>
        </div>
        <div class="btn-row" style="align-items:flex-end">
          ${yearSelect(data.year, t)}
          <button class="btn btn--secondary" type="button" data-edit>Ubah kegiatan</button>
          ${data.year === Number(t.slice(0, 4)) && (isCond || curPeriod) ? `<button class="btn btn--primary" type="button" data-now>${isDaily ? 'Centang hari ini' : isCond ? 'Catat pelaksanaan' : 'Centang periode ini'}</button>` : ''}
        </div>
      </div>
    </div>
    ${isCond ? '' : `<section class="stats" aria-label="Ringkasan ${data.year}">
      <div class="stat"><p class="stat__label">Kepatuhan ${data.year}</p><p class="stat__value">${pct(a.pct)}</p><div class="bar" aria-hidden="true"><i style="width:${a.pct ?? 0}%"></i></div></div>
      <div class="stat"><p class="stat__label">Periode selesai</p><p class="stat__value">${a.done}<small>dari ${a.due} yang sudah jatuh tempo</small></p></div>
      <div class="stat"><p class="stat__label">Periode terlewat</p><p class="stat__value">${a.missed}</p></div>
    </section>`}
    ${isCond ? '' : `<section aria-labelledby="h-per"><div class="section-head"><h2 id="h-per">${isDaily ? 'Kalender ceklis' : 'Periode'} ${data.year}</h2></div>
      ${isDaily ? dailyCalendar(a, data.year, holidays, t) : periodTiles(a)}</section>`}
    <section aria-labelledby="h-hist">
      <div class="section-head"><h2 id="h-hist">Riwayat pelaksanaan ${data.year}</h2><p>${checks.length} catatan</p></div>
      <div class="table-box">${checks.length ? `<table class="table">
        <thead><tr><th>Tanggal</th><th>Catatan</th><th>Lampiran</th><th>Dicatat</th><th><span class="sr-only" style="position:absolute;left:-9999px">Aksi</span></th></tr></thead>
        <tbody>${checks.map((c) => `<tr>
          <td style="white-space:nowrap">${fmtDate(c.done_date)}</td>
          <td>${esc(c.note) || '<span class="muted">–</span>'}</td>
          <td><div class="files">${c.files.map((f) => `<a href="/api/files/${f.id}" target="_blank" rel="noopener">${esc(f.filename)}</a>`).join('') || '<span class="muted">–</span>'}</div></td>
          <td style="font-size:14px">${esc(c.user_name || '(pengguna dihapus)')}<br><span class="muted">${fmtTime(c.created_at)}</span>${late(c) ? '<br><span class="tag tag--late">Dicatat terlambat</span>' : ''}</td>
          <td class="num"><button class="btn-text" type="button" data-edit-check="${c.id}">Ubah</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="empty">Belum ada pelaksanaan yang dicatat pada tahun ini.</p>'}</div>
    </section>
    ${info.length ? `<details class="info"><summary>Rincian program</summary><dl>${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}`;

  $('#year').onchange = (e) => (location.hash = `#/kegiatan/${id}?tahun=${e.target.value}`);
  $('[data-edit]', main).onclick = () => activityDialog(a, refresh);
  $('[data-now]', main)?.addEventListener('click', () => checkForPeriod(a, isCond ? null : curPeriod, t, refresh));
  $$('[data-edit-check]', main).forEach((b) => b.addEventListener('click', () => {
    const c = a.checks.find((x) => x.id === Number(b.dataset.editCheck));
    const p = a.periods.find((x) => c.done_date >= x.start && c.done_date <= x.end);
    // Mengubah tanggal hanya dalam periode yang sama agar tidak memindahkan bukti ke periode lain tanpa sengaja.
    checkDialog({ activity: a, check: c, min: isCond ? a.start_date : maxDate(p?.start, a.start_date), max: isCond ? t : minDate(p?.end, t), periodLabel: p?.label, after: refresh });
  }));
  $$('[data-date]', main).forEach((b) => b.addEventListener('click', () => {
    const date = b.dataset.date;
    const c = a.checks.find((x) => x.done_date === date);
    if (c) checkDialog({ activity: a, check: c, min: date, max: date, periodLabel: fmtLong(date), after: refresh });
    else checkDialog({ activity: a, date, min: date, max: date, periodLabel: fmtLong(date), after: refresh });
  }));
  $$('[data-period]', main).forEach((b) => b.addEventListener('click', () => checkForPeriod(a, a.periods[Number(b.dataset.period)], t, refresh)));
}

// ---------- Halaman: Kalender ----------
async function viewCalendar(params) {
  const ym = /^\d{4}-\d{2}$/.test(params.get('bulan') || '') ? params.get('bulan') : null;
  const reqYear = ym ? Number(ym.slice(0, 4)) : undefined;
  const data = await api(`/calendar${reqYear ? `?year=${reqYear}` : ''}`);
  const t = data.today;
  const year = data.year;
  const month = ym ? Math.min(12, Math.max(1, Number(ym.slice(5, 7)))) : Number(t.slice(5, 7));
  const ymStr = `${year}-${String(month).padStart(2, '0')}`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selParam = params.get('tanggal');
  const selected = selParam && selParam.startsWith(ymStr + '-') ? selParam : t.startsWith(ymStr + '-') ? t : `${ymStr}-01`;
  const refresh = (nextYm = ymStr, nextDay = selected) => (location.hash = `#/kalender?bulan=${nextYm}&tanggal=${nextDay}`);

  const holMap = new Map(data.holidays.map((h) => [h.date, h.name]));
  const dailyActs = data.activities.filter((a) => a.frequency === 'harian');
  const checksByDate = new Map();
  for (const a of data.activities)
    for (const c of a.checks) {
      if (!checksByDate.has(c.done_date)) checksByDate.set(c.done_date, []);
      checksByDate.get(c.done_date).push({ ...c, activity: a });
    }

  const firstDow = (new Date(`${ymStr}-01T00:00:00Z`).getUTCDay() + 6) % 7; // Senin = 0
  let cells = '<div class="mcal__cell mcal__cell--empty"></div>'.repeat(firstDow);
  for (let d = 1; d <= last; d++) {
    const date = `${ymStr}-${String(d).padStart(2, '0')}`;
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const hol = holMap.get(date);
    const pills = [];
    for (const a of dailyActs) {
      const p = a.periods.find((x) => x.start === date);
      if (p && p.status !== 'akan') {
        const mark = { selesai: '✓', terlewat: '✗', berjalan: '•' }[p.status];
        pills.push(`<span class="mcal__pill mcal__pill--${p.status}">${mark} ${esc(a.name.split(' ')[0])}</span>`);
      }
    }
    for (const item of checksByDate.get(date) || [])
      if (item.activity.frequency !== 'harian')
        pills.push(`<span class="mcal__pill mcal__pill--selesai">✓ ${esc(item.activity.name)}</span>`);
    cells += `<button type="button" class="mcal__cell${isWeekend || hol ? ' is-off' : ''}${date === t ? ' is-today' : ''}${date === selected ? ' is-selected' : ''}" data-pick="${date}">
      <span class="mcal__num">${d}</span>
      ${hol ? `<span class="mcal__hol">${esc(hol)}</span>` : ''}
      <span class="mcal__pills">${pills.slice(0, 3).join('')}${pills.length > 3 ? `<span class="mcal__pill">+${pills.length - 3} lainnya</span>` : ''}</span>
    </button>`;
  }

  const prevM = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const nextM = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const selHol = holMap.get(selected);
  const selDow = new Date(selected + 'T00:00:00Z').getUTCDay();
  const selChecks = checksByDate.get(selected) || [];
  const monthStart = `${ymStr}-01`, monthEnd = `${ymStr}-${String(last).padStart(2, '0')}`;
  const dueInMonth = data.activities
    .filter((a) => !['harian', 'kondisional'].includes(a.frequency))
    .map((a) => ({ a, p: a.periods.find((p) => p.start <= monthEnd && p.end >= monthStart) }))
    .filter((x) => x.p);

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Kalender ${BULAN[month - 1]} ${year}</h1><p>Klik tanggal untuk melihat atau mencatat pelaksanaan kegiatan</p></div>
      <div class="btn-row" style="align-items:flex-end">
        <div class="field" style="min-width:140px"><label for="c-month">Bulan</label>
          <select id="c-month">${BULAN.map((b, i) => `<option value="${i + 1}" ${i + 1 === month ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        ${yearSelect(year, t)}
        <button class="btn btn--secondary" type="button" data-nav="${prevM}" aria-label="Bulan sebelumnya">←</button>
        <button class="btn btn--secondary" type="button" data-nav="${nextM}" aria-label="Bulan berikutnya">→</button>
        <button class="btn btn--secondary" type="button" data-today>Hari ini</button>
      </div>
    </div>
    <div class="cal-layout">
      <div>
        <div class="mcal">
          <div class="mcal__weekdays">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((h) => `<span>${h}</span>`).join('')}</div>
          <div class="mcal__grid">${cells}</div>
        </div>
        <div class="legend">
          <span><i class="s-selesai"></i>Selesai</span>
          <span><i class="s-terlewat"></i>Harian terlewat</span>
          <span><i class="s-berjalan"></i>Hari ini belum dicentang</span>
        </div>
      </div>
      <aside class="day-panel" aria-label="Rincian tanggal terpilih">
        <div>
          <h2>${fmtLong(selected)}</h2>
          ${selHol ? `<p class="hint" style="color:var(--bad);margin-top:4px">Libur nasional/cuti bersama: ${esc(selHol)}</p>`
            : selDow === 0 || selDow === 6 ? '<p class="hint" style="margin-top:4px">Akhir pekan (bukan hari kerja)</p>' : ''}
        </div>
        ${dailyActs.map((a) => {
          const p = a.periods.find((x) => x.start === selected);
          const c = a.checks.find((x) => x.done_date === selected);
          if (!p) return '';
          return `<div class="day-panel__item">
            <strong>${esc(a.name)}</strong>
            <div class="row__meta" style="margin:0">${tag(p.status)}${p.late ? '<span class="tag tag--late">Dicatat terlambat</span>' : ''}</div>
            ${p.status === 'akan' ? '' : c
              ? `<div><button class="btn-text" type="button" data-edit-check="${a.id}:${c.id}">Ubah ceklis harian</button></div>`
              : `<div style="margin-top:4px"><button class="btn btn--primary btn--sm" type="button" data-daily="${a.id}">Centang tanggal ini</button></div>`}
          </div>`;
        }).join('')}
        <div>
          <h3>Catatan pada tanggal ini (${selChecks.length})</h3>
          <div class="day-panel__list" style="margin-top:8px">
            ${selChecks.length ? selChecks.map((c) => `<div class="day-panel__item">
              <a class="row__title" href="#/kegiatan/${c.activity.id}?tahun=${year}">${esc(c.activity.name)}</a>
              <span class="muted">${esc(c.activity.freqLabel)} · oleh ${esc(c.user_name || '(pengguna dihapus)')}</span>
              ${c.note ? `<p>${esc(c.note)}</p>` : ''}
              ${c.files.length ? `<div class="files">${c.files.map((f) => `<a href="/api/files/${f.id}" target="_blank" rel="noopener">${esc(f.filename)}</a>`).join('')}</div>` : ''}
              <div><button class="btn-text" type="button" data-edit-check="${c.activity.id}:${c.id}">Ubah</button></div>
            </div>`).join('') : '<p class="muted" style="font-size:14px">Belum ada pelaksanaan yang dicatat pada tanggal ini.</p>'}
          </div>
        </div>
        ${selected <= t ? `<button class="btn btn--secondary" type="button" data-add-on-date>Catat kegiatan di tanggal ini</button>` : '<p class="hint">Tanggal yang belum berjalan belum dapat dicentang.</p>'}
      </aside>
    </div>
    <section aria-labelledby="h-mper">
      <div class="section-head"><h2 id="h-mper">Kewajiban periode yang mencakup ${BULAN[month - 1]} ${year}</h2><p>Bulanan, triwulan, semester, dan tahunan</p></div>
      <div class="list">${dueInMonth.map(({ a, p }) => `<div class="row">
        <div>
          <a class="row__title" href="#/kegiatan/${a.id}?tahun=${year}">${esc(a.name)}</a>
          <div class="row__meta"><span>${esc(a.freqLabel)}</span><span>${esc(p.label)}</span>${tag(p.status)}${a.target > 1 ? `<span>${p.count} dari ${a.target} kali</span>` : ''}</div>
        </div>
        ${p.status === 'akan' ? '' : p.status === 'selesai'
          ? `<a class="btn btn--secondary" href="#/kegiatan/${a.id}?tahun=${year}">Lihat riwayat</a>`
          : `<button class="btn btn--primary" type="button" data-check-period="${a.id}">Centang pelaksanaan</button>`}
      </div>`).join('')}</div>
    </section>`;

  const goYm = (nextYm) => refresh(nextYm, `${nextYm}-01`);
  $('#c-month').onchange = (e) => goYm(`${year}-${String(e.target.value).padStart(2, '0')}`);
  $('#year').onchange = (e) => goYm(`${e.target.value}-${String(month).padStart(2, '0')}`);
  $$('[data-nav]', main).forEach((b) => (b.onclick = () => goYm(b.dataset.nav)));
  $('[data-today]', main).onclick = () => refresh(t.slice(0, 7), t);
  $$('[data-pick]', main).forEach((b) => (b.onclick = () => refresh(ymStr, b.dataset.pick)));
  $$('[data-daily]', main).forEach((b) => b.addEventListener('click', () => {
    const a = data.activities.find((x) => x.id === Number(b.dataset.daily));
    checkDialog({ activity: a, date: selected, min: selected, max: selected, periodLabel: fmtLong(selected), after: () => viewCalendar(params) });
  }));
  $$('[data-edit-check]', main).forEach((b) => b.addEventListener('click', () => {
    const [aid, cid] = b.dataset.editCheck.split(':').map(Number);
    const a = data.activities.find((x) => x.id === aid);
    const c = a.checks.find((x) => x.id === cid);
    const p = a.periods.find((x) => c.done_date >= x.start && c.done_date <= x.end);
    const isCond = a.frequency === 'kondisional';
    checkDialog({ activity: a, check: c, min: isCond ? a.start_date : maxDate(p?.start, a.start_date), max: isCond ? t : minDate(p?.end, t), periodLabel: p?.label || fmtLong(c.done_date), after: () => viewCalendar(params) });
  }));
  $$('[data-check-period]', main).forEach((b) => b.addEventListener('click', () => {
    const item = dueInMonth.find(({ a }) => a.id === Number(b.dataset.checkPeriod));
    checkForPeriod(item.a, item.p, t, () => viewCalendar(params));
  }));
  $('[data-add-on-date]', main)?.addEventListener('click', () => {
    const eligible = data.activities.filter((a) => a.start_date <= selected);
    openDialog({
      title: 'Catat pelaksanaan',
      sub: fmtLong(selected),
      submit: 'Simpan ceklis',
      body:
        field('pick-a', 'Program kegiatan', `<select id="pick-a" name="activity_id">${eligible.map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(a.freqLabel)})</option>`).join('')}</select>`) +
        `<input type="hidden" name="done_date" value="${esc(selected)}">` +
        field('c-note', 'Catatan', '<textarea id="c-note" name="note" rows="3" maxlength="2000" aria-describedby="c-note-err"></textarea>') +
        field('c-files', 'Lampiran bukti', input('c-files', 'files', 'type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"'), 'PDF, JPG, atau PNG. Maksimal 5 MB per berkas.'),
      onSubmit: async (form) => {
        const picked = [...form.elements.files.files];
        const big = picked.find((f) => f.size > MAX_FILE);
        if (big) throw Object.assign(new ApiError(`${big.name} lebih dari 5 MB. Perkecil dulu berkasnya.`), { field: 'files' });
        const fd = new FormData(form);
        if (!picked.length) fd.delete('files');
        await api('/checks', { method: 'POST', body: fd });
        toast('Ceklis tersimpan');
        viewCalendar(params);
      },
    });
  });
}

// ---------- Halaman: Laporan ----------
async function viewReport(params) {
  const year = Number(params.get('tahun')) || undefined;
  const data = await api(`/report${year ? `?year=${year}` : ''}`);
  const cellText = (c) => {
    if (c.status === 'info') return esc(c.text);
    if (c.status === 'kosong' || c.status === 'akan') return '';
    const mark = { selesai: '✓', terlewat: '✗', berjalan: '…' }[c.status];
    return `${c.text ? esc(c.text) : `<span aria-hidden="true">${mark}</span>`}<span style="position:absolute;left:-9999px">${STATUS[c.status]}</span>${c.late ? '<br><small>terlambat</small>' : ''}`;
  };
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Laporan kepatuhan ${data.year}</h1><p>Keadaan ${fmtLong(data.today)} · BPS Kabupaten Parigi Moutong</p></div>
      <div class="btn-row no-print" style="align-items:flex-end">
        ${yearSelect(data.year, data.today)}
        <a class="btn btn--secondary" href="/api/report.xlsx?year=${data.year}" download>Unduh Excel</a>
        <button class="btn btn--primary" type="button" data-print>Cetak atau simpan PDF</button>
      </div>
    </div>
    <div class="table-box"><table class="table report">
      <thead><tr><th>No</th><th>Program</th><th>Periode</th><th class="num">Kepatuhan</th><th class="num">Selesai</th><th class="num">Terlewat</th>${BLN.map((b) => `<th class="m" scope="col">${b}</th>`).join('')}</tr></thead>
      <tbody>${data.rows.map((r, n) => `<tr>
        <td>${n + 1}</td>
        <td style="min-width:220px"><a class="row__title" href="#/kegiatan/${r.id}?tahun=${data.year}">${esc(r.name)}</a></td>
        <td style="white-space:nowrap">${esc(r.freqLabel)}${r.target > 1 && r.frequency !== 'harian' && r.frequency !== 'kondisional' ? ` (${r.target}×)` : ''}</td>
        <td class="num">${r.frequency === 'kondisional' ? '–' : pct(r.pct)}</td>
        <td class="num">${r.frequency === 'kondisional' ? '–' : `${r.done}/${r.due}`}</td>
        <td class="num">${r.frequency === 'kondisional' ? '–' : r.missed}</td>
        ${r.cells.map((c) => `<td class="m s-${c.status}" colspan="${c.to - c.from + 1}" style="position:relative">${cellText(c)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="legend"><span><i class="s-selesai"></i>✓ Selesai</span><span><i class="s-terlewat"></i>✗ Terlewat</span><span><i class="s-berjalan"></i>… Periode berjalan</span><span>Angka x/y: jumlah terlaksana dari target (harian: hari kerja)</span><span>Kepatuhan = periode selesai dibagi periode yang sudah jatuh tempo</span></div>`;
  $('#year').onchange = (e) => (location.hash = `#/laporan?tahun=${e.target.value}`);
  $('[data-print]', main).onclick = () => window.print();
}

// ---------- Halaman: Pengaturan ----------
async function viewSettings(params) {
  const year = Number(params.get('tahun')) || new Date().getFullYear();
  const [holidays, users, me] = await Promise.all([api(`/holidays?year=${year}`), api('/users'), api('/me')]);
  main.innerHTML = `
    <div class="page-head"><div><h1>Pengaturan</h1><p>Hari libur dan akun pengguna. Semua pengguna punya hak yang sama.</p></div></div>
    <section aria-labelledby="h-hol">
      <div class="section-head"><h2 id="h-hol">Hari libur ${year}</h2><div class="no-print">${yearSelect(year, new Date().toISOString())}</div></div>
      <form class="form-inline" id="hol-form" novalidate style="margin-bottom:16px">
        ${field('h-date', 'Tanggal', input('h-date', 'date', 'type="date" required'))}
        ${field('h-name', 'Keterangan', input('h-name', 'name', 'required maxlength="200" placeholder="Misal: Cuti bersama Idulfitri"'))}
        <button class="btn btn--primary" type="submit">Tambah hari libur</button>
        <p class="form__status" role="status"></p>
      </form>
      <div class="table-box">${holidays.length ? `<table class="table"><thead><tr><th>Tanggal</th><th>Keterangan</th><th></th></tr></thead><tbody>
        ${holidays.map((h) => `<tr><td style="white-space:nowrap">${fmtLong(h.date)}</td><td>${esc(h.name)}</td><td class="num"><button class="btn-text danger" type="button" data-del-hol="${h.date}">Hapus</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">Belum ada hari libur untuk tahun ini.</p>'}</div>
      <p class="hint" style="margin-top:12px">Hari libur di hari kerja tidak dihitung sebagai kewajiban ceklis harian.</p>
    </section>
    <section aria-labelledby="h-users">
      <div class="section-head"><h2 id="h-users">Pengguna</h2><p>${users.length} akun</p></div>
      <form class="form-grid" id="user-form" novalidate style="margin-bottom:16px">
        <div class="form-grid form-grid--2">
          ${field('u-name', 'Nama lengkap', input('u-name', 'name', 'required maxlength="100" autocomplete="off"'))}
          ${field('u-username', 'Nama pengguna', input('u-username', 'username', 'required maxlength="30" autocomplete="off" autocapitalize="none"'), 'Huruf kecil, angka, titik, garis bawah, atau tanda hubung.')}
        </div>
        <div class="form-grid form-grid--2" style="align-items:start">
          ${field('u-pass', 'Kata sandi awal', input('u-pass', 'password', 'type="password" required minlength="8" autocomplete="new-password"'), 'Minimal 8 karakter.')}
          <div><button class="btn btn--primary" type="submit" style="margin-top:27px">Tambah pengguna</button></div>
        </div>
        <p class="form__status" role="status"></p>
      </form>
      <div class="table-box"><table class="table"><thead><tr><th>Nama</th><th>Nama pengguna</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td>${esc(u.name)}${u.id === me.id ? ' <span class="tag">Anda</span>' : ''}</td><td>${esc(u.username)}</td>
          <td class="num"><button class="btn-text" type="button" data-pass="${u.id}">Ganti kata sandi</button>${u.id === me.id ? '' : ` <button class="btn-text danger" type="button" data-del-user="${u.id}">Hapus</button>`}</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;

  $('#year').onchange = (e) => (location.hash = `#/pengaturan?tahun=${e.target.value}`);
  const refresh = () => viewSettings(params);
  bindForm($('#hol-form'), async (form) => {
    await api('/holidays', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    toast('Hari libur tersimpan');
    refresh();
  });
  $$('[data-del-hol]', main).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Hapus hari libur ${fmtDate(b.dataset.delHol)}?`)) return;
    await api(`/holidays/${b.dataset.delHol}`, { method: 'DELETE' });
    toast('Hari libur dihapus');
    refresh();
  }));
  bindForm($('#user-form'), async (form) => {
    await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    toast('Pengguna ditambahkan');
    refresh();
  });
  $$('[data-pass]', main).forEach((b) => b.addEventListener('click', () => {
    const u = users.find((x) => x.id === Number(b.dataset.pass));
    openDialog({
      title: 'Ganti kata sandi', sub: `${u.name} (${u.username})`, submit: 'Simpan kata sandi',
      body: field('p-pass', 'Kata sandi baru', input('p-pass', 'password', 'type="password" required minlength="8" autocomplete="new-password"'), 'Minimal 8 karakter. Sesi lain milik akun ini akan keluar.'),
      onSubmit: async (form) => { await api(`/users/${u.id}/password`, { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); toast('Kata sandi diganti'); },
    });
  }));
  $$('[data-del-user]', main).forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === Number(b.dataset.delUser));
    if (!confirm(`Hapus akun ${u.name}? Ceklis yang pernah ia buat tetap tersimpan.`)) return;
    await api(`/users/${u.id}`, { method: 'DELETE' });
    toast('Pengguna dihapus');
    refresh();
  }));
}

// ---------- Masuk ----------
function showLogin() {
  $('.topbar').hidden = true;
  main.innerHTML = `<div class="login view-enter"><form class="login__box" novalidate>
    <span class="brand__mark" aria-hidden="true"></span>
    <div><h1>Ceklis Manajemen Perubahan</h1><p class="muted" style="margin-top:6px">BPS Kabupaten Parigi Moutong</p></div>
    ${field('l-user', 'Nama pengguna', input('l-user', 'username', 'required autocomplete="username" autocapitalize="none"'))}
    ${field('l-pass', 'Kata sandi', input('l-pass', 'password', 'type="password" required autocomplete="current-password"'))}
    <p class="form__status" role="status"></p>
    <button class="btn btn--primary" type="submit">Masuk</button>
  </form></div>`;
  bindForm($('form', main), async (form) => {
    await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    if (!location.hash || location.hash === '#/') render(); else render();
  });
  $('#l-user').focus();
}

$('[data-logout]').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); showLogin(); });

// ---------- Rute ----------
const routes = [
  [/^#?\/?$/, () => viewDashboard()],
  [/^#\/kalender$/, (m, p) => viewCalendar(p)],
  [/^#\/kegiatan$/, () => viewActivities()],
  [/^#\/kegiatan\/(\d+)$/, (m, p) => viewActivity(m[1], p)],
  [/^#\/laporan$/, (m, p) => viewReport(p)],
  [/^#\/pengaturan$/, (m, p) => viewSettings(p)],
];

async function render() {
  const [path, query] = location.hash.split('?');
  const params = new URLSearchParams(query);
  let me;
  try { me = await api('/me'); } catch { return; }
  $('.topbar').hidden = false;
  $('[data-user]').textContent = me.name;
  const section = path.split('/')[1] || '';
  $$('.mainnav a').forEach((a) => (a.getAttribute('href').split('/')[1] === section ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const route = routes.find(([re]) => re.test(path));
  try {
    if (!route) { main.innerHTML = '<h1>Halaman tidak ditemukan</h1><p><a href="#/">Kembali ke dasbor</a></p>'; return; }
    await route[1](path.match(route[0]), params);
    main.classList.remove('view-enter');
    void main.offsetWidth;
    main.classList.add('view-enter');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    main.innerHTML = `<div><h1>Gagal memuat</h1><p class="muted" style="margin-top:8px">${esc(err.message)}</p><p style="margin-top:16px"><a href="#/">Kembali ke dasbor</a></p></div>`;
  }
}

let lastPath = location.hash.split('?')[0];
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  render();
});
render();
