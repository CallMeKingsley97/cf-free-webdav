const style = `
  :root { color-scheme: light; --line: #dfe5ee; --muted: #667788; --blue: #2563eb; --red: #dc2626; --green: #16a34a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f7fb; color: #17212b; font-family: system-ui, -apple-system, sans-serif; }
  .app { max-width: 1080px; margin: auto; padding: 24px 16px 48px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 5px 20px #0f172608; overflow: hidden; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button, .file label, input, .breadcrumbs a, .breadcrumbs span { border: 1px solid var(--line); border-radius: 8px; background: #fff; color: #17212b; font: inherit; outline: none; }
  button { padding: 8px 12px; cursor: pointer; white-space: nowrap; transition: .15s; }
  .file input { display: none; }
  .file label { display: block; padding: 8px 12px; cursor: pointer; }
  button:hover, .file:hover { border-color: #94a3b8; background: #f8fafc; }
  .primary { background: var(--blue) !important; border-color: var(--blue) !important; color: #fff !important; }
  .danger { color: var(--red) !important; }
  .danger:hover { background: #fef2f2 !important; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 20px 24px; border-bottom: 1px solid var(--line); }
  .quota { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: #fbfcfe; }
  .quota h3 { margin: 0 0 6px; font-size: 14px; }
  .value { font-size: 20px; font-weight: 650; }
  .note { color: var(--muted); font-size: 12px; }
  .bar { height: 9px; background: #e6ebf2; border-radius: 20px; margin: 9px 0 5px; overflow: hidden; }
  .fill { height: 100%; background: var(--green); border-radius: 20px; transition: width .25s; }
  .warn { background: #d97706; }
  .dangerfill { background: var(--red); }
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid var(--line); }
  .breadcrumbs { flex: 1; min-width: 0; overflow: auto; white-space: nowrap; display: flex; gap: 3px; color: var(--muted); }
  .breadcrumbs a { padding: 5px 7px; text-decoration: none; }
  .tablewrap { max-height: 56vh; overflow: auto; }
  .table { width: 100%; border-collapse: collapse; min-width: 720px; }
  th, td { padding: 11px 16px; border-bottom: 1px solid #eef2f7; text-align: left; font-size: 14px; }
  th { position: sticky; top: 0; background: #f8fafc; color: var(--muted); font-size: 12px; white-space: nowrap; z-index: 1; }
  td:last-child, th:last-child { text-align: right; white-space: nowrap; }
  .row:hover td { background: #fbfdff; }
  td a { color: var(--blue); text-decoration: none; word-break: break-all; }
  td a:hover { text-decoration: underline; }
  .icon { display: inline-block; width: 16px; height: 16px; vertical-align: -2px; margin-right: 6px; fill: currentColor; }
  .dir .icon { color: #d97706; }
  .file-icon { color: #64748b; }
  .empty { padding: 35px; text-align: center; color: var(--muted); }
  #message { position: fixed; z-index: 20; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 11px 16px; border-radius: 10px; background: #17212b; color: #fff; font-size: 14px; box-shadow: 0 8px 25px #0f172630; opacity: 0; pointer-events: none; transition: .2s; }
  #message.show { opacity: 1; }
  #message.error { background: var(--red); }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; padding: 14px; } .header, .toolbar { padding: 14px; flex-wrap: wrap; } .tablewrap { max-height: none; } }
`;

const script = `
  const el = (id) => document.getElementById(id);
  let currentPath = [];
  const dirIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
  const fileIcon = '<svg class="icon file-icon" viewBox="0 0 24 24"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/></svg>';

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

  function quotaCard(title, used, total, unit) {
    const ratio = total > 0 ? Math.min(1, used / total) : 0;
    const percent = Math.round(ratio * 100);
    const cls = percent >= 90 ? 'fill dangerfill' : percent >= 75 ? 'fill warn' : 'fill';
    return '<article class="quota"><h3>' + title + '</h3><div class="value">' + percent + '%</div>' +
      '<div class="bar"><div class="' + cls + '" style="width:' + percent + '%"></div></div>' +
      '<div class="note">' + used.toLocaleString('zh-CN') + ' / ' + total.toLocaleString('zh-CN') + ' ' + unit + '</div></article>';
  }

  function renderQuota(usage) {
    const limits = usage.limits;
    el('quota').innerHTML = quotaCard('存储用量', usage.state.storageBytes, limits.storageBytes, '字节') +
      quotaCard('A 类操作', usage.state.classAOperations, limits.classAOperations, '次') +
      quotaCard('B 类操作', usage.state.classBOperations, limits.classBOperations, '次');
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
    if (!entries.length) { el('rows').innerHTML = '<tr><td colspan="4" class="empty">此目录为空</td></tr>'; return; }
    el('rows').innerHTML = entries.map((item) => {
      const key = item.key.split('/').map(encodeURIComponent).join('/');
      const safeHref = attr(item.href);
      const safeKey = attr(key);
      const name = item.collection
        ? '<a href="#" data-dir="' + safeKey + '">' + dirIcon + esc(item.name) + '</a>'
        : '<a href="' + safeHref + '" target="_blank" rel="noopener">' + fileIcon + esc(item.name) + '</a>';
      const action = item.collection ? '<button disabled>删除</button>' : '<button class="danger" data-delete="' + safeKey + '">删除</button>';
      return '<tr><td>' + name + '</td><td>' + (item.collection ? '—' : fmtSize(item.size)) + '</td><td>' + fmtDate(item.uploaded) + '</td><td>' + action + '</td></tr>';
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
    try {
      const response = await fetch(apiPath(currentPath), { cache: 'no-store' });
      if (response.status === 401) { notify('认证失败，请刷新后重新登录', true); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      currentPath = data.path || [];
      renderQuota(data.usage);
      renderEntries(data.entries);
      renderBreadcrumbs(data.path || []);
    } catch (error) { notify(error.message || '加载失败', true); }
  }

  function initialize() {
    const value = decodeURIComponent(location.hash.slice(1));
    currentPath = value ? value.split('/') : [];
    loadFiles();
  }

  el('refresh').addEventListener('click', loadFiles);
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
  <section class="card">
    <header class="header">
      <div><h1>CF Free WebDAV</h1><div class="sub">使用当前 WebDAV 账号浏览、上传和管理 R2 文件</div></div>
      <div class="actions"><button id="refresh">刷新</button><button id="sync" class="primary">同步官方用量</button></div>
    </header>
    <div id="quota" class="grid"><div class="quota"><h3>加载中</h3></div><div class="quota"><h3>加载中</h3></div><div class="quota"><h3>加载中</h3></div></div>
    <div class="toolbar">
      <nav id="breadcrumbs" class="breadcrumbs" aria-label="目录路径"></nav>
      <label class="file"><input id="file" type="file" multiple><span>上传</span></label>
    </div>
    <div class="tablewrap">
      <table class="table"><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table>
    </div>
  </section>
</main>
<div id="message"></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
