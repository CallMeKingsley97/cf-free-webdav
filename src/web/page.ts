const style = `
  :root { color-scheme: light; --canvas: #f3f6fb; --surface: #fff; --line: #e5eaf2; --muted: #64748b; --text: #17243a; --blue: #2563eb; --blue-dark: #1d4ed8; --red: #dc4545; --green: #16865b; --amber: #d58a16; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; background: radial-gradient(ellipse at 16% 0%, #e7efff 0, transparent 34rem), var(--canvas); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
  button, input { font: inherit; }
  button, a, label { -webkit-tap-highlight-color: transparent; }
  .app { max-width: 1280px; margin: auto; padding: 38px 32px 64px; }
  .page-header { display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
  .brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .brand-mark { display: grid; place-items: center; width: 52px; height: 52px; flex: 0 0 auto; border: 1px solid #cddcff; border-radius: 16px; background: linear-gradient(145deg, #fff, #eaf1ff); color: var(--blue); box-shadow: 0 5px 14px #315fba12; }
  .brand-mark svg { width: 27px; height: 27px; }
  .eyebrow { margin: 0 0 7px; color: #60718b; font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; color: #14233b; font-size: clamp(23px, 3vw, 29px); font-weight: 700; letter-spacing: -.04em; line-height: 1.15; }
  .sub { margin-top: 6px; color: var(--muted); font-size: 14px; line-height: 1.55; }
  .actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  button, .upload-label { display: inline-flex; justify-content: center; align-items: center; gap: 8px; min-height: 42px; padding: 0 15px; border: 1px solid #dbe3ee; border-radius: 11px; background: #fff; color: #26364d; font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap; transition: background-color .18s ease, border-color .18s ease, box-shadow .18s ease, color .18s ease; }
  button svg, .upload-label svg { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  button:hover, .upload-label:hover { border-color: #b9c9df; background: #f8faff; }
  button:active, .upload-label:active { background: #eef3fb; }
  button:disabled, .upload input:disabled + .upload-label { opacity: .6; cursor: wait; }
  button:focus-visible, a:focus-visible, input:focus-visible + .upload-label { outline: 3px solid #93b4ff; outline-offset: 2px; }
  .primary { border-color: var(--blue); background: var(--blue); color: #fff; box-shadow: 0 5px 12px #2563eb25; }
  .primary:hover { border-color: var(--blue-dark); background: var(--blue-dark); }
  .btn-icon { width: 16px; height: 16px; }
  .overview { margin-bottom: 22px; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin: 0 2px 12px; }
  .section-heading h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
  .section-heading p { margin: 0; color: var(--muted); font-size: 12px; }
  .quota-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .quota { min-width: 0; padding: 19px 20px 17px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); box-shadow: 0 4px 16px #1e3a5f08; }
  .quota-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .quota-label { display: flex; align-items: center; gap: 9px; color: #53647d; font-size: 13px; font-weight: 650; }
  .quota-icon { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 10px; background: #edf3ff; color: #4172d8; }
  .quota-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .quota-percent { color: #52647d; background: #f1f5fa; padding: 5px 8px; border-radius: 7px; font: 650 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .quota-percent.warn { color: #94600b; background: #fff4da; }
  .quota-percent.danger { color: #b72e35; background: #ffeded; }
  .quota-value { margin-top: 16px; color: #162844; font-size: 25px; font-weight: 720; letter-spacing: -.04em; line-height: 1.15; overflow-wrap: anywhere; }
  .quota-limit { margin-top: 4px; color: #75849a; font-size: 12px; }
  .bar { height: 7px; margin: 15px 0 11px; overflow: hidden; border-radius: 99px; background: #edf1f6; }
  .fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #4b83f4, #2862db); transition: width .25s ease; }
  .fill.warn { background: linear-gradient(90deg, #edbd59, #d68d1b); }
  .fill.danger { background: linear-gradient(90deg, #ed7777, #d94343); }
  .quota-foot { display: flex; justify-content: space-between; gap: 8px; color: #65758c; font-size: 11px; }
  .quota-foot strong { color: #33445c; font-weight: 650; }
  .panel { overflow: hidden; border: 1px solid var(--line); border-radius: 17px; background: var(--surface); box-shadow: 0 8px 26px #1e3a5f0b; }
  .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 19px 22px 16px; }
  .panel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .panel-title h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
  #entry-count { color: #718198; font-size: 12px; white-space: nowrap; }
  .status { display: inline-flex; align-items: center; gap: 7px; color: #557069; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #2aa875; box-shadow: 0 0 0 3px #e6f6ef; }
  .status.loading { color: #7b6a43; }
  .status.loading .status-dot { background: #d59a25; box-shadow: 0 0 0 3px #fff5df; }
  .status.error { color: #a74141; }
  .status.error .status-dot { background: #d84848; box-shadow: 0 0 0 3px #ffebeb; }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 22px; border-top: 1px solid #edf0f5; border-bottom: 1px solid #edf0f5; background: #fbfcfe; }
  .breadcrumbs { display: flex; align-items: center; flex: 1; min-width: 0; gap: 5px; overflow: auto; color: #8a98ab; white-space: nowrap; scrollbar-width: thin; }
  .breadcrumbs a { padding: 6px 8px; border-radius: 7px; color: #53647d; font-size: 12px; text-decoration: none; }
  .breadcrumbs a:hover { background: #edf3ff; color: var(--blue); }
  .breadcrumbs a:first-child { color: #275bc2; font-weight: 650; }
  .toolbar-tools { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }
  .search { position: relative; display: flex; align-items: center; }
  .search svg { position: absolute; left: 11px; width: 15px; height: 15px; color: #8492a6; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; pointer-events: none; }
  .search input { width: 190px; height: 40px; padding: 0 12px 0 34px; border: 1px solid #dfe6ef; border-radius: 10px; outline: none; background: #fff; color: var(--text); font-size: 12px; transition: border-color .18s ease, box-shadow .18s ease; }
  .search input::placeholder { color: #9aa7b8; }
  .search input:focus { border-color: #8eaff4; box-shadow: 0 0 0 3px #dce8ff; }
  .search input:focus-visible { outline: none; }
  .upload { position: relative; }
  .upload input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); border: 0; }
  .upload-label { min-height: 40px; padding: 0 13px; border-color: #cbd9f3; color: #245ac0; }
  .upload-label:hover { border-color: #9bb5e9; background: #f0f5ff; }
  .upload input:focus-visible + .upload-label { outline: 3px solid #93b4ff; outline-offset: 2px; }
  .tablewrap { max-height: 62vh; overflow: auto; }
  .table { width: 100%; border-collapse: collapse; }
  th, td { padding: 13px 20px; border-bottom: 1px solid #edf0f5; text-align: left; font-size: 13px; }
  th { position: sticky; top: 0; z-index: 1; background: #f8fafd; color: #728198; font-size: 11px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
  td { color: #56677e; }
  td:first-child { min-width: 260px; color: #263851; font-weight: 560; }
  td:last-child, th:last-child { width: 94px; text-align: right; white-space: nowrap; }
  .row:hover td { background: #f8faff; }
  td a { color: inherit; text-decoration: none; }
  td a:hover { color: var(--blue); }
  .icon { display: inline-block; width: 17px; height: 17px; margin-right: 8px; vertical-align: -3px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  td a[data-dir] .icon { color: #d89622; }
  .file-icon { color: #7890ad; }
  .row button { min-height: 32px; padding: 0 10px; border-color: transparent; background: transparent; color: #8794a6; font-size: 12px; font-weight: 550; }
  .row button:hover { border-color: #f4caca; background: #fff4f4; color: var(--red); }
  .row button:disabled { color: #aeb7c4; cursor: not-allowed; }
  .empty-cell { padding: 60px 24px !important; text-align: center !important; color: #7b8aa0 !important; font-weight: 450 !important; }
  .empty-icon { display: block; width: 36px; height: 36px; margin: 0 auto 10px; color: #9aa9bc; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  #message { position: fixed; z-index: 20; left: 50%; bottom: 22px; max-width: calc(100vw - 32px); padding: 12px 17px; transform: translateX(-50%); border: 1px solid #ffffff20; border-radius: 12px; background: #17243a; color: #fff; font-size: 13px; box-shadow: 0 12px 32px #14233b30; opacity: 0; pointer-events: none; transition: opacity .2s ease; }
  #message.show { opacity: 1; }
  #message.error { background: #b9363e; }
  .footer-note { margin: 13px 4px 0; color: #8794a6; font-size: 11px; line-height: 1.6; }
  @media (max-width: 900px) { .app { padding: 28px 22px 48px; } .quota { padding: 16px; } .quota-value { font-size: 22px; } .search input { width: 160px; } }
  @media (max-width: 680px) {
    .app { padding: 22px 14px 36px; }
    .page-header { align-items: flex-start; flex-direction: column; gap: 16px; margin-bottom: 23px; }
    .brand { align-items: flex-start; gap: 12px; }
    .brand-mark { width: 44px; height: 44px; border-radius: 13px; }
    .brand-mark svg { width: 23px; height: 23px; }
    .sub { max-width: 32ch; font-size: 13px; }
    .actions { width: 100%; }
    .actions button { flex: 1; }
    .overview { margin-bottom: 18px; }
    .section-heading { align-items: flex-start; flex-direction: column; gap: 4px; }
    .quota-grid { grid-template-columns: 1fr; gap: 9px; }
    .quota { padding: 14px 15px; }
    .quota-top { align-items: center; }
    .quota-value { display: inline-block; margin-top: 12px; font-size: 22px; }
    .quota-limit { display: inline-block; margin: 0 0 0 7px; }
    .bar { margin: 11px 0 8px; }
    .panel { border-radius: 14px; }
    .panel-heading { padding: 16px 15px 13px; }
    .toolbar { align-items: stretch; flex-direction: column; padding: 11px 13px 13px; }
    .toolbar-tools { width: 100%; }
    .search { flex: 1; min-width: 0; }
    .search input { width: 100%; }
    .upload-label { min-width: 82px; }
    .tablewrap { max-height: none; overflow: visible; }
    .table, .table tbody { display: block; width: 100%; }
    .table thead { display: none; }
    .table tr.row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 14px; margin: 0 10px 9px; padding: 9px 11px; border: 1px solid #e9edf4; border-radius: 11px; background: #fff; }
    .table tr.row:last-child { margin-bottom: 10px; }
    .table td { min-width: 0; padding: 7px 0; border: 0; font-size: 11px; overflow-wrap: anywhere; }
    .table td::before { display: block; margin-bottom: 4px; color: #91a0b3; content: attr(data-label); font-size: 10px; font-weight: 600; }
    .table td:first-child { grid-column: 1 / -1; padding-bottom: 10px; font-size: 13px; }
    .table td:first-child::before { margin-bottom: 6px; }
    .table td:last-child { grid-column: 1 / -1; width: auto; padding-top: 5px; border-top: 1px solid #f0f2f6; text-align: right; }
    .table td:last-child::before { display: none; }
    .table td:nth-child(3) { display: none; }
    .row button { min-height: 34px; padding: 0 10px; }
    .empty-cell { display: block !important; padding: 48px 20px !important; border: 0 !important; }
    .footer-note { margin-top: 10px; }
  }
  @media (max-width: 380px) { .actions { gap: 7px; } button, .upload-label { padding-right: 10px; padding-left: 10px; font-size: 12px; } .quota-foot { font-size: 10px; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
`;

const script = `
  const el = (id) => document.getElementById(id);
  let currentPath = [];
  let currentEntries = [];
  const dirIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M3.5 10h17"/></svg>';
  const fileIcon = '<svg class="icon file-icon" viewBox="0 0 24 24"><path d="M6 3.5h7l5 5v12H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M13 3.5v5h5M8 13h8M8 16.5h8"/></svg>';

  const esc = (value) => { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; };
  const attr = (value) => esc(value).replace(/"/g, '&quot;');
  const apiPath = (segments) => '/api/files?path=' + encodeURIComponent(segments.join('/'));
  const davPath = (segments) => '/dav/' + segments.map(encodeURIComponent).join('/');

  function fmtSize(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return value + ' B';
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let size = value / 1024; let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return size.toLocaleString('zh-CN', { maximumFractionDigits: size < 10 ? 2 : 1 }) + ' ' + units[index];
  }

  function fmtDate(value) {
    return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function notify(text, error = false) {
    const box = el('message');
    box.textContent = text;
    box.className = error ? 'show error' : 'show';
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { box.className = ''; }, 3200);
  }

  function quotaCard(title, used, total, unit, icon) {
    const ratio = total > 0 ? Math.min(1, used / total) : 0;
    const percent = Math.round(ratio * 100);
    const tone = percent >= 90 ? 'danger' : percent >= 75 ? 'warn' : '';
    const format = unit === '字节' ? fmtSize : (value) => value.toLocaleString('zh-CN');
    const remaining = Math.max(0, total - used);
    return '<article class="quota"><div class="quota-top"><div class="quota-label"><span class="quota-icon">' + icon + '</span>' + title + '</div>' +
      '<span class="quota-percent ' + tone + '">' + percent + '% 已用</span></div>' +
      '<div class="quota-value">' + format(used) + '</div><div class="quota-limit">上限 ' + format(total) + '</div>' +
      '<div class="bar"><div class="fill ' + tone + '" style="width:' + percent + '%"></div></div>' +
      '<div class="quota-foot"><span>当前周期</span><span>剩余 <strong>' + format(remaining) + '</strong></span></div></article>';
  }

  function renderQuota(usage) {
    const limits = usage.limits;
    el('quota').innerHTML = quotaCard('存储空间', usage.state.storageBytes, limits.storageBytes, '字节', '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>') +
      quotaCard('A 类操作', usage.state.classAOperations, limits.classAOperations, '次', '<svg viewBox="0 0 24 24"><path d="M12 3v18M17 7.5c0-1.7-2-3-5-3S7 6 7 8s1.7 3 5 4 5 2.3 5 4-2 3.5-5 3.5-5-1.4-5-3.5"/></svg>') +
      quotaCard('B 类操作', usage.state.classBOperations, limits.classBOperations, '次', '<svg viewBox="0 0 24 24"><path d="M4 18V6M4 18h16M8 15l3-4 3 2 5-7"/><path d="M16 6h3v3"/></svg>');
    document.title = usage.blocked ? 'CF Free WebDAV - 熔断' : 'CF Free WebDAV';
  }

  function renderBreadcrumbs(segments) {
    let html = '<a href="#" data-empty="1">根目录</a>';
    segments.forEach((part, index) => { html += '<span>/</span><a href="#" data-index="' + index + '">' + esc(part) + '</a>'; });
    el('breadcrumbs').innerHTML = html;
    el('breadcrumbs').querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const next = link.dataset.empty === undefined ? segments.slice(0, Number(link.dataset.index) + 1) : [];
        location.hash = encodeURIComponent(next.join('/'));
      });
    });
  }

  function renderEntries(entries) {
    currentEntries = entries;
    const query = el('search').value.trim().toLocaleLowerCase('zh-CN');
    const visibleEntries = entries.filter((item) => item.name.toLocaleLowerCase('zh-CN').includes(query));
    el('entry-count').textContent = query ? visibleEntries.length + ' / ' + entries.length + ' 个项目' : entries.length + ' 个项目';
    if (!visibleEntries.length) {
      const message = entries.length ? '没有找到匹配的文件' : '此目录还没有文件';
      el('rows').innerHTML = '<tr><td colspan="5" class="empty-cell"><svg class="empty-icon" viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><path d="M8 13h8"/></svg>' + message + '</td></tr>';
      return;
    }
    el('rows').innerHTML = visibleEntries.map((item) => {
      const safeHref = attr(item.href);
      const safeKey = attr(item.key);
      const name = item.collection
        ? '<a href="#" data-dir="' + safeKey + '">' + dirIcon + esc(item.name) + '</a>'
        : '<a href="' + safeHref + '" target="_blank" rel="noopener">' + fileIcon + esc(item.name) + '</a>';
      const action = item.collection ? '<button disabled aria-label="目录暂不支持删除">删除</button>' : '<button data-delete="' + safeKey + '" aria-label="删除 ' + attr(item.name) + '">删除</button>';
      return '<tr class="row"><td data-label="名称">' + name + '</td><td data-label="大小">' + (item.collection ? '—' : fmtSize(item.size)) + '</td><td data-label="创建时间">' +
        (item.createdAt ? fmtDate(item.createdAt) : '—') + '</td><td data-label="修改时间">' + fmtDate(item.uploaded) + '</td><td data-label="操作">' + action + '</td></tr>';
    }).join('');
  }

  async function upload(file) {
    const response = await fetch(davPath([...currentPath, file.name]), {
      method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
    });
    if (!response.ok) throw new Error((await response.text()) || '上传失败');
    notify('已上传：' + file.name);
  }

  async function remove(key) {
    if (!confirm('确定删除 ' + key.split('/').pop() + ' 吗？')) return false;
    const response = await fetch(davPath(key.split('/')), { method: 'DELETE' });
    if (!response.ok) throw new Error('删除失败');
    notify('文件已删除');
    return true;
  }

  async function loadFiles() {
    const status = el('status');
    status.className = 'status loading';
    status.lastChild.textContent = '正在连接';
    try {
      const response = await fetch(apiPath(currentPath), { cache: 'no-store' });
      if (response.status === 401) { notify('认证失败，请刷新后重新登录', true); status.className = 'status error'; status.lastChild.textContent = '认证失败'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      currentPath = data.path || [];
      renderQuota(data.usage);
      renderEntries(data.entries);
      renderBreadcrumbs(data.path || []);
      status.className = 'status';
      status.lastChild.textContent = '存储服务正常';
    } catch (error) {
      notify(error.message || '加载失败', true);
      status.className = 'status error';
      status.lastChild.textContent = '连接失败';
    }
  }

  function initialize() {
    const value = decodeURIComponent(location.hash.slice(1));
    currentPath = value ? value.split('/') : [];
    loadFiles();
  }

  el('refresh').addEventListener('click', loadFiles);
  el('search').addEventListener('input', () => renderEntries(currentEntries));
  el('sync').addEventListener('click', async () => {
    el('sync').disabled = true;
    try {
      const response = await fetch('/usage/reconcile-official', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '同步失败');
      notify('官方用量已同步');
      loadFiles();
    } catch (error) { notify(error.message || '同步失败', true); }
    finally { el('sync').disabled = false; }
  });
  el('file').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    el('file').disabled = true;
    try { for (const file of files) await upload(file); loadFiles(); }
    catch (error) { notify(error.message || '上传失败', true); }
    finally { el('file').disabled = false; event.target.value = ''; }
  });
  el('rows').addEventListener('click', async (event) => {
    const dir = event.target.closest('[data-dir]');
    const del = event.target.closest('[data-delete]');
    if (dir) { event.preventDefault(); location.hash = encodeURIComponent(dir.dataset.dir || ''); }
    else if (del) { event.preventDefault(); try { if (await remove(del.dataset.delete)) loadFiles(); } catch (error) { notify(error.message || '删除失败', true); } }
  });
  window.addEventListener('hashchange', initialize);
  initialize();
`;

export function webPage(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CF Free WebDAV</title>
  <style nonce="${nonce}">${style}</style>
</head>
<body>
<main class="app">
  <header class="page-header">
    <div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5A2.5 2.5 0 0 1 7.5 5H11l2 2h3.5A2.5 2.5 0 0 1 19 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5z"/><path d="M5 10h14"/><path d="M9 14h6"/></svg></div><div><p class="eyebrow">OBJECT STORAGE · CONTROL CENTER</p><h1>CF Free WebDAV</h1><div class="sub">浏览和管理 R2 文件，随时掌握存储用量</div></div></div>
    <div class="actions"><button id="refresh"><svg class="btn-icon" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-3L4 10"/><path d="M4 5v5h5M4 13a8 8 0 0 0 14.8 3L20 14"/><path d="M20 19v-5h-5"/></svg>刷新列表</button><button id="sync" class="primary"><svg class="btn-icon" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></svg>同步官方用量</button></div>
  </header>
  <section class="overview" aria-labelledby="usage-title">
    <div class="section-heading"><h2 id="usage-title">用量概览</h2><p>当前周期的额度使用情况</p></div>
    <div id="quota" class="quota-grid"><article class="quota"><div class="quota-label">正在加载用量…</div></article><article class="quota"><div class="quota-label">正在加载用量…</div></article><article class="quota"><div class="quota-label">正在加载用量…</div></article></div>
  </section>
  <section class="panel" aria-labelledby="files-title">
    <div class="panel-heading"><div class="panel-title"><h2 id="files-title">文件管理</h2><span id="entry-count">正在加载</span></div><div id="status" class="status loading" role="status" aria-live="polite"><span class="status-dot"></span><span>正在连接</span></div></div>
    <div class="toolbar">
      <nav id="breadcrumbs" class="breadcrumbs" aria-label="目录路径"></nav>
      <div class="toolbar-tools"><label class="search"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></svg><input id="search" type="search" placeholder="搜索当前目录" aria-label="搜索当前目录"></label><div class="upload"><input id="file" type="file" multiple><label class="upload-label" for="file"><svg viewBox="0 0 24 24"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>上传文件</label></div></div>
    </div>
    <div class="tablewrap">
      <table class="table"><thead><tr><th>名称</th><th>大小</th><th>创建时间</th><th>修改时间</th><th>操作</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="empty-cell">正在加载文件列表…</td></tr></tbody></table>
    </div>
  </section>
  <p class="footer-note">用量数据为 Worker 侧统计估算；点击“同步官方用量”可与 Cloudflare 官方数据校准。</p>
</main>
<div id="message"></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
