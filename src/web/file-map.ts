export const fileMapStyle = `
  #star-map-backdrop { background: #15223870; backdrop-filter: blur(6px); }
  .dialog.map-dialog { display: flex; flex-direction: column; width: min(1160px, 100%); max-height: calc(100dvh - 48px); padding: 0; overflow: hidden; border: 1px solid #dce3ed; border-radius: 18px; box-shadow: 0 24px 80px #14233b30; }
  .map-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px; border-bottom: 1px solid #e9edf3; }
  .map-heading-main { display: flex; align-items: center; gap: 12px; }
  .map-brand-icon { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid #dce7f5; border-radius: 12px; background: #f0f5fc; color: #426b9c; }
  .map-brand-icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .map-heading h3 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
  .map-heading p { margin: 5px 0 0; color: #64748b; font-size: 12px; }
  #star-map-close { width: 40px; min-height: 40px; padding: 0; border-color: transparent; border-radius: 10px; background: transparent; color: #64748b; box-shadow: none; }
  #star-map-close:hover { background: #f0f3f8; color: #1e293b; }
  #star-map-close svg { width: 19px; height: 19px; }
  .map-body { min-height: 0; overflow: auto; padding: 22px 26px 18px; overscroll-behavior: contain; }
  .map-summary { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
  .map-summary-label { display: block; margin-bottom: 5px; color: #64748b; font-size: 12px; }
  #map-total { color: #22354d; font-size: 32px; font-weight: 680; line-height: 1.15; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
  #map-count { margin: 8px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
  .map-reading { display: flex; align-items: center; gap: 7px; padding-bottom: 3px; color: #64748b; font-size: 11px; white-space: nowrap; }
  .map-reading svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .map-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .map-modes { display: inline-flex; flex: 0 0 auto; gap: 3px; padding: 3px; border: 1px solid #e4e9f1; border-radius: 9px; background: #f4f6fa; }
  .map-modes button { min-height: 34px; padding: 0 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #64748b; font-size: 12px; font-weight: 550; box-shadow: none; }
  .map-modes button:hover { color: #334b68; }
  .map-modes button.active { border-color: #e1e7ef; background: #fff; color: #2d5482; box-shadow: 0 1px 3px #20385608; }
  .map-breadcrumbs { display: flex; align-items: center; gap: 3px; min-width: 0; overflow: auto; color: #94a3b8; white-space: nowrap; }
  .map-breadcrumbs button { min-height: 36px; padding: 0 7px; border-color: transparent; border-radius: 6px; background: transparent; color: #64748b; font-size: 12px; font-weight: 500; }
  .map-breadcrumbs button[aria-current] { color: #273f5b; font-weight: 650; }
  .map-breadcrumbs button:hover { background: #f2f5f9; color: #275bc2; }
  .map-breadcrumbs svg { width: 15px; height: 15px; }
  .map-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 252px; gap: 20px; }
  #star-map { position: relative; height: clamp(320px, 44vh, 440px); min-width: 0; overflow: hidden; border: 1px solid #e6ebf2; border-radius: 12px; background: #f5f7fb; }
  .map-tile { position: absolute; display: block; min-width: 0; min-height: 0; padding: 0; overflow: hidden; border: 0; border-radius: 0; background: transparent; white-space: normal; box-shadow: none; text-align: left; }
  .map-tile:hover, .map-tile:active { border: 0; background: transparent; }
  .map-tile-surface { position: absolute; inset: 4px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; overflow: hidden; padding: 15px; border: 1px solid #ffffffa6; border-radius: 8px; background: var(--map-fill); color: #27486a; transition: box-shadow .16s ease, filter .16s ease; }
  .map-tile:hover .map-tile-surface, .map-tile.is-highlighted .map-tile-surface { box-shadow: inset 0 0 0 1.5px #496d98; filter: brightness(.98); }
  .map-tile:focus-visible { outline: none; }
  .map-tile:focus-visible .map-tile-surface { box-shadow: inset 0 0 0 2px #2563eb; }
  .map-tile-top { display: flex; align-items: start; justify-content: space-between; gap: 9px; min-width: 0; }
  .map-tile-name { display: -webkit-box; min-width: 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font-size: 13px; font-weight: 650; line-height: 1.45; }
  .map-tile-arrow { flex: 0 0 auto; width: 14px; height: 14px; opacity: .7; }
  .map-tile-bottom { display: flex; align-items: end; justify-content: space-between; flex-wrap: wrap; gap: 5px 10px; }
  .map-tile-size { display: block; font-size: 20px; font-weight: 650; letter-spacing: -.035em; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .map-tile-meta { display: block; margin-top: 4px; color: #47617f; font-size: 10px; font-weight: 450; }
  .map-tile-share { color: #375675; font-size: 11px; font-weight: 550; font-variant-numeric: tabular-nums; }
  .map-tile.is-compact .map-tile-surface { gap: 5px; padding: 10px; }
  .map-tile.is-compact .map-tile-size { font-size: 15px; }
  .map-tile.is-compact .map-tile-meta { display: none; }
  .map-tile.is-tiny .map-tile-surface { padding: 0; }
  .map-tile.is-tiny .map-tile-top, .map-tile.is-tiny .map-tile-bottom { display: none; }
  .map-tone-0 { --map-fill: #eef3f9; }
  .map-tone-1 { --map-fill: #e1ebf6; }
  .map-tone-2 { --map-fill: #d1e1f2; }
  .map-tone-3 { --map-fill: #bfd5ec; }
  .map-tone-4 { --map-fill: #aac9e7; }
  .map-kind-image { --map-fill: #dceee5; }
  .map-kind-video { --map-fill: #f3e6d8; }
  .map-kind-audio { --map-fill: #e8e4f2; }
  .map-kind-document { --map-fill: #dce8f5; }
  .map-kind-archive { --map-fill: #f1e3e7; }
  .map-kind-other { --map-fill: #e7ebf0; }
  .map-sidebar { display: flex; flex-direction: column; min-width: 0; height: clamp(320px, 44vh, 440px); padding-left: 1px; }
  .map-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 1px 2px 12px; border-bottom: 1px solid #edf0f5; }
  .map-list-heading h4 { margin: 0; color: #33465e; font-size: 12px; font-weight: 650; }
  #map-list-count { color: #64748b; font-size: 11px; }
  #map-items { flex: 1; min-height: 0; overflow: auto; padding-top: 3px; scrollbar-width: thin; }
  .map-list-item { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; min-height: 65px; padding: 11px 3px; border: 0; border-bottom: 1px solid #f0f3f7; border-radius: 0; background: transparent; color: #33465e; box-shadow: none; text-align: left; text-decoration: none; }
  .map-list-item:hover, .map-list-item.is-highlighted { border-color: #f0f3f7; background: #f5f8fc; }
  .map-list-icon { display: grid; place-items: center; width: 29px; height: 32px; border-radius: 7px; background: #f0f4f9; color: #6b86a8; }
  .map-list-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .map-list-copy { min-width: 0; }
  .map-list-name { display: block; overflow: hidden; color: #33465e; font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
  .map-list-meta { display: block; margin-top: 5px; color: #64748b; font-size: 10px; font-weight: 450; }
  .map-list-share { color: #475d77; font-size: 11px; font-weight: 550; font-variant-numeric: tabular-nums; }
  .map-list-more { width: 100%; min-height: 40px; margin-top: 7px; border: 0; background: #f5f7fa; color: #526b88; font-size: 11px; }
  .map-footer { display: flex; align-items: start; justify-content: space-between; gap: 14px; padding-top: 14px; color: #64748b; font-size: 11px; }
  .map-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 13px; }
  .map-legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .map-legend i { width: 9px; height: 9px; border: 1px solid #516b851a; border-radius: 3px; background: var(--map-fill); }
  .map-legend-scale { display: flex; align-items: center; gap: 3px; }
  .map-legend-scale i { border: 0; border-radius: 1px; width: 12px; }
  .map-hint { margin: 0; line-height: 1.5; white-space: nowrap; }
  .map-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 24px; color: #64748b; font-size: 13px; text-align: center; line-height: 1.6; }
  .map-state svg { width: 30px; height: 30px; fill: none; stroke: #8aa1bd; stroke-width: 1.4; }
  .map-state strong { color: #33465e; font-size: 14px; font-weight: 600; }
  .map-state-note { font-size: 12px; }
  @media (max-width: 820px) { .map-workspace { grid-template-columns: minmax(0,1fr) 205px; gap: 14px; } .map-heading { padding: 19px 20px; } .map-body { padding: 20px; } }
  @media (max-width: 680px) {
    #star-map-backdrop { padding: 12px; }
    .dialog.map-dialog { max-height: calc(100dvh - 24px); border-radius: 14px; }
    .map-heading { padding: 16px; }
    .map-heading h3 { font-size: 16px; }
    .map-heading p { font-size: 11px; }
    .map-brand-icon { width: 36px; height: 36px; border-radius: 10px; }
    .map-body { padding: 18px 14px; }
    .map-summary { align-items: start; margin-bottom: 18px; }
    #map-total { font-size: 28px; }
    .map-reading { max-width: 110px; padding-top: 5px; white-space: normal; line-height: 1.6; }
    .map-reading svg { flex: 0 0 auto; }
    .map-controls { flex-direction: column; align-items: stretch; gap: 9px; }
    .map-modes { align-self: stretch; }
    .map-modes button { flex: 1; min-height: 38px; }
    .map-workspace { grid-template-columns: minmax(0,1fr); gap: 18px; }
    #star-map { height: 300px; }
    .map-tile-surface { inset: 3px; padding: 10px; }
    .map-tile-name { font-size: 12px; }
    .map-tile-size { font-size: 17px; }
    .map-sidebar { height: auto; }
    #map-items { max-height: 270px; }
    .map-footer { flex-direction: column; gap: 10px; }
    .map-hint { white-space: normal; }
    #star-map-close { width: 44px; min-height: 44px; }
  }
`;

export const fileMapMarkup = `
<div id="star-map-backdrop" class="dialog-backdrop">
  <div class="dialog map-dialog" role="dialog" aria-modal="true" aria-labelledby="map-title" aria-describedby="map-description">
    <header class="map-heading">
      <div class="map-heading-main"><span class="map-brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M11 3v18M11 13h10"/></svg></span><div><h3 id="map-title">文件星图</h3><p id="map-description">看清空间分布，找到占用来源</p></div></div>
      <button id="star-map-close" aria-label="关闭星图"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="map-body">
      <div class="map-summary"><div><span class="map-summary-label">当前目录占用</span><strong id="map-total">—</strong><p id="map-count" role="status" aria-live="polite">正在扫描</p></div><span class="map-reading"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M10 3v14M10 10h7"/></svg>色块面积代表文件大小</span></div>
      <div class="map-controls"><nav id="map-breadcrumbs" class="map-breadcrumbs" aria-label="星图目录路径"></nav><div class="map-modes" role="group" aria-label="星图着色方式"><button data-map-mode="size" class="active" aria-pressed="true">按大小</button><button data-map-mode="type" aria-pressed="false">按类型</button><button data-map-mode="updated" aria-pressed="false">按时间</button></div></div>
      <div class="map-workspace"><div id="star-map" role="group" aria-label="文件空间分布图" aria-busy="false"></div><aside class="map-sidebar" aria-labelledby="map-list-title"><div class="map-list-heading"><h4 id="map-list-title">占用明细</h4><span id="map-list-count"></span></div><div id="map-items"></div></aside></div>
      <div class="map-footer"><div id="map-legend" class="map-legend" aria-label="颜色图例"></div><p class="map-hint">点击文件夹深入查看，点击文件打开</p></div>
    </div>
  </div>
</div>`;

export const fileMapScript = String.raw`
  (() => {
    let mapPath = [];
    let mapEntries = [];
    let mapNodes = [];
    let mapMode = 'size';
    let mapRequest = 0;
    let mapPartial = false;
    let mapReady = false;
    let mapListLimit = 100;
    let mapReturnFocus = null;
    let mapController = null;
    const folderSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>';
    const fileSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>';
    const kinds = { '图片': 'image', '视频': 'video', '音频': 'audio', '文档': 'document', '压缩包': 'archive', '其他': 'other' };
    const percent = (size, total) => total ? (size / total * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%' : '0%';

    function closeStarMap() {
      el('star-map-backdrop').classList.remove('show');
      mapRequest += 1;
      if (mapController) mapController.abort();
      if (mapReturnFocus) mapReturnFocus.focus();
    }

    function mapState(title, note = '') {
      el('star-map').innerHTML = '<div class="map-state">' + folderSvg + '<strong>' + esc(title) + '</strong>' + (note ? '<span class="map-state-note">' + esc(note) + '</span>' : '') + '</div>';
    }

    async function loadStarMap() {
      const request = ++mapRequest;
      if (mapController) mapController.abort();
      mapController = new AbortController();
      mapReady = false;
      mapListLimit = 100;
      mapEntries = [];
      mapNodes = [];
      el('star-map').setAttribute('aria-busy', 'true');
      el('map-total').textContent = '—';
      el('map-count').textContent = '正在扫描当前目录…';
      el('map-list-count').textContent = '';
      el('map-items').replaceChildren();
      el('map-legend').replaceChildren();
      renderMapBreadcrumbs();
      mapState('正在绘制空间分布', '文件较多时可能需要一点时间');
      try {
        let cursor = null;
        let files = [];
        let scanned = 0;
        let partial = false;
        do {
          const params = new URLSearchParams({ path: mapPath.join('/') });
          if (cursor) params.set('cursor', cursor);
          const response = await fetch('/api/map?' + params, { cache: 'no-store', signal: mapController.signal });
          const data = await response.json();
          if (request !== mapRequest) return;
          if (!response.ok) throw new Error(data.error || '星图加载失败');
          files = files.concat(data.entries || []);
          scanned += data.scanned || (data.entries || []).length;
          cursor = data.cursor || null;
          if (files.length >= 10000 || scanned >= 10000) { partial = Boolean(cursor) || files.length > 10000; files = files.slice(0, 10000); break; }
          el('map-count').textContent = '已扫描 ' + files.length.toLocaleString('zh-CN') + ' 个文件…';
        } while (cursor);
        if (request !== mapRequest) return;
        mapEntries = files;
        mapPartial = partial;
        mapReady = true;
        renderStarMap();
      } catch (error) {
        if (request !== mapRequest || error.name === 'AbortError') return;
        mapState('暂时无法绘制星图', error.message || '请关闭后重试');
        el('map-count').textContent = '加载失败';
      } finally {
        if (request === mapRequest) el('star-map').setAttribute('aria-busy', 'false');
      }
    }

    function mapType(contentType, name) {
      const type = (contentType || '').toLowerCase();
      if (type.startsWith('image/')) return '图片';
      if (type.startsWith('video/')) return '视频';
      if (type.startsWith('audio/')) return '音频';
      if (type.startsWith('text/') || type.includes('pdf') || /\.(docx?|xlsx?|pptx?)$/i.test(name)) return '文档';
      if (/\.(zip|7z|rar|gz|tar)$/i.test(name)) return '压缩包';
      return '其他';
    }

    function collectMapNodes() {
      const nodes = new Map();
      for (const file of mapEntries) {
        const relative = file.name.split('/');
        const name = relative[0];
        const collection = relative.length > 1;
        const key = [...mapPath, name].join('/');
        const identity = key + (collection ? '/' : '');
        if (!nodes.has(identity)) nodes.set(identity, { name, key, collection, size: 0, count: 0, latest: 0, types: {} });
        const node = nodes.get(identity);
        const type = mapType(file.contentType, file.name);
        node.size += file.size;
        node.count += 1;
        node.latest = Math.max(node.latest, Date.parse(file.uploaded) || 0);
        node.types[type] = (node.types[type] || 0) + file.size;
        node.type = Object.entries(node.types).sort((a, b) => b[1] - a[1])[0]?.[0] || type;
      }
      return [...nodes.values()].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, 'zh-CN'));
    }

    function nodeTone(node, maximum) {
      if (mapMode === 'type') return 'map-kind-' + (kinds[node.type] || 'other');
      if (mapMode === 'updated') {
        const age = node.latest ? (Date.now() - node.latest) / 86400000 : Infinity;
        return 'map-tone-' + (age < 1 ? 4 : age < 7 ? 3 : age < 30 ? 2 : age < 365 ? 1 : 0);
      }
      return 'map-tone-' + (maximum ? Math.min(4, Math.floor(node.size / maximum * 4)) : 0);
    }

    function renderStarMap() {
      if (!mapReady) return;
      mapNodes = collectMapNodes();
      const total = mapNodes.reduce((sum, node) => sum + node.size, 0);
      const folders = mapNodes.filter((node) => node.collection).length;
      const files = mapNodes.length - folders;
      el('map-total').textContent = fmtSize(total);
      el('map-count').textContent = folders + ' 个文件夹 · ' + files + ' 个文件' + (mapPartial ? ' · 部分结果（扫描上限 10,000 项）' : '');
      el('map-list-count').textContent = mapNodes.length + ' 项';
      if (!mapNodes.length) {
        mapState('这个目录还没有文件', '上传文件后，即可在这里查看空间分布');
        el('map-items').innerHTML = '<p class="map-state-note">暂无占用记录</p>';
        renderMapLegend();
        return;
      }
      const host = el('star-map');
      const width = host.clientWidth || 700;
      const height = host.clientHeight || 400;
      const maximum = mapNodes[0].size;
      // 零字节文件保留极小的可点面积；实际占比仍显示为 0，可从明细列表访问。
      const minimumWeight = maximum ? maximum * 0.000001 : 1;
      const positions = layoutMap(mapNodes, width, height, (node) => Math.max(minimumWeight, node.size));
      const tiles = document.createDocumentFragment();
      for (const { node, x, y, w, h } of positions) {
        const index = mapNodes.indexOf(node);
        const tile = document.createElement('button');
        tile.className = 'map-tile ' + nodeTone(node, maximum) + (w < 130 || h < 108 ? ' is-compact' : '') + (w < 74 || h < 54 ? ' is-tiny' : '');
        tile.type = 'button';
        tile.dataset.mapIndex = String(index);
        if (node.collection) tile.dataset.mapDir = node.key;
        else tile.dataset.mapFile = node.key;
        tile.style.left = x / width * 100 + '%';
        tile.style.top = y / height * 100 + '%';
        tile.style.width = w / width * 100 + '%';
        tile.style.height = h / height * 100 + '%';
        tile.title = node.name + ' · ' + fmtSize(node.size) + ' · ' + percent(node.size, total);
        tile.setAttribute('aria-label', (node.collection ? '进入文件夹 ' : '打开文件 ') + tile.title);
        const meta = mapMode === 'updated' ? (node.latest ? fmtDate(node.latest) : '暂无修改时间') : node.collection ? node.count + ' 个文件' : node.type;
        tile.innerHTML = '<span class="map-tile-surface"><span class="map-tile-top"><span class="map-tile-name">' + esc(node.name) + '</span><svg class="map-tile-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' + (node.collection ? '<path d="m6 4 4 4-4 4"/>' : '<path d="M4 12 12 4M5 4h7v7"/>') + '</svg></span><span class="map-tile-bottom"><span><span class="map-tile-size">' + fmtSize(node.size) + '</span><span class="map-tile-meta">' + esc(meta) + '</span></span><span class="map-tile-share">' + percent(node.size, total) + '</span></span></span>';
        tiles.append(tile);
      }
      host.replaceChildren(tiles);
      renderMapList(total);
      renderMapLegend();
    }

    // Squarified treemap：优先形成接近正方形的块，并保留真实面积比例。
    function layoutMap(nodes, width, height, weight) {
      const total = nodes.reduce((sum, node) => sum + weight(node), 0);
      const entries = nodes.map((node) => ({ node, area: weight(node) / total * width * height }));
      const result = [];
      let box = { x: 0, y: 0, w: width, h: height };
      let row = [];
      let sum = 0;
      const worst = (items, area, side) => {
        if (!items.length || !side) return Infinity;
        const max = items[0].area;
        const min = items[items.length - 1].area;
        return Math.max(side * side * max / (area * area), area * area / (side * side * min));
      };
      const place = () => {
        const vertical = box.w >= box.h;
        const thickness = sum / (vertical ? box.h : box.w);
        let offset = 0;
        for (const item of row) {
          const length = item.area / thickness;
          result.push({ node: item.node, x: box.x + (vertical ? 0 : offset), y: box.y + (vertical ? offset : 0), w: vertical ? thickness : length, h: vertical ? length : thickness });
          offset += length;
        }
        box = vertical ? { x: box.x + thickness, y: box.y, w: Math.max(0, box.w - thickness), h: box.h } : { x: box.x, y: box.y + thickness, w: box.w, h: Math.max(0, box.h - thickness) };
        row = [];
        sum = 0;
      };
      for (const item of entries) {
        const side = Math.min(box.w, box.h);
        if (row.length && worst(row.concat(item), sum + item.area, side) > worst(row, sum, side)) place();
        row.push(item);
        sum += item.area;
      }
      if (row.length) place();
      return result;
    }

    function renderMapList(total) {
      el('map-items').innerHTML = mapNodes.slice(0, mapListLimit).map((node, index) => {
        const target = node.collection ? 'data-map-dir="' + attr(node.key) + '"' : 'data-map-file="' + attr(node.key) + '"';
        const meta = (node.collection ? node.count + ' 个文件 · ' : '') + fmtSize(node.size);
        return '<button class="map-list-item" data-map-index="' + index + '" ' + target + ' aria-label="' + attr((node.collection ? '进入文件夹 ' : '打开文件 ') + node.name) + '"><span class="map-list-icon">' + (node.collection ? folderSvg : fileSvg) + '</span><span class="map-list-copy"><span class="map-list-name">' + esc(node.name) + '</span><span class="map-list-meta">' + esc(meta) + '</span></span><span class="map-list-share">' + percent(node.size, total) + '</span></button>';
      }).join('') + (mapNodes.length > mapListLimit ? '<button class="map-list-more" data-map-more>显示更多（剩余 ' + (mapNodes.length - mapListLimit) + ' 项）</button>' : '');
    }

    function renderMapLegend() {
      const items = mapMode === 'type'
        ? Object.entries(kinds).map(([label, kind]) => '<span><i class="map-kind-' + kind + '"></i>' + label + '</span>').join('')
        : mapMode === 'updated'
          ? ['1 天内', '7 天内', '30 天内', '1 年内', '更早'].map((label, index) => '<span><i class="map-tone-' + (4 - index) + '"></i>' + label + '</span>').join('')
          : '<span>较小</span><span class="map-legend-scale">' + [0, 1, 2, 3, 4].map((index) => '<i class="map-tone-' + index + '"></i>').join('') + '</span><span>较大</span>';
      el('map-legend').innerHTML = items;
    }

    function renderMapBreadcrumbs() {
      let html = '<button data-map-root' + (!mapPath.length ? ' aria-current="location"' : '') + '>' + folderSvg + '根目录</button>';
      mapPath.forEach((part, index) => { html += '<span aria-hidden="true">/</span><button data-map-crumb="' + index + '"' + (index === mapPath.length - 1 ? ' aria-current="location"' : '') + '>' + esc(part) + '</button>'; });
      el('map-breadcrumbs').innerHTML = html;
    }

    function highlightMapItem(event) {
      const node = event.target.closest('[data-map-index]');
      const index = node?.dataset.mapIndex;
      document.querySelectorAll('#star-map-backdrop .is-highlighted').forEach((item) => item.classList.remove('is-highlighted'));
      if (index !== undefined) document.querySelectorAll('#star-map-backdrop [data-map-index="' + index + '"]').forEach((item) => item.classList.add('is-highlighted'));
    }

    el('star-map-open').addEventListener('click', () => {
      mapReturnFocus = document.activeElement;
      mapPath = [...currentPath];
      mapMode = 'size';
      document.querySelectorAll('[data-map-mode]').forEach((button) => { button.classList.toggle('active', button.dataset.mapMode === mapMode); button.setAttribute('aria-pressed', String(button.dataset.mapMode === mapMode)); });
      el('star-map-backdrop').classList.add('show');
      el('star-map-close').focus();
      loadStarMap();
    });
    el('star-map-close').addEventListener('click', closeStarMap);
    el('star-map-backdrop').addEventListener('click', (event) => {
      if (event.target === el('star-map-backdrop')) { closeStarMap(); return; }
      const root = event.target.closest('[data-map-root]');
      const crumb = event.target.closest('[data-map-crumb]');
      const directory = event.target.closest('[data-map-dir]');
      const file = event.target.closest('[data-map-file]');
      if (root || crumb || directory) {
        mapPath = root ? [] : crumb ? mapPath.slice(0, Number(crumb.dataset.mapCrumb) + 1) : directory.dataset.mapDir.split('/').filter(Boolean);
        el('star-map-close').focus();
        loadStarMap();
      } else if (file) window.open(davPath(file.dataset.mapFile.split('/')), '_blank', 'noopener');
      else if (event.target.closest('[data-map-more]')) { mapListLimit += 100; renderMapList(mapNodes.reduce((sum, node) => sum + node.size, 0)); }
    });
    document.querySelectorAll('[data-map-mode]').forEach((button) => button.addEventListener('click', () => {
      mapMode = button.dataset.mapMode;
      document.querySelectorAll('[data-map-mode]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
      renderStarMap();
    }));
    el('star-map-backdrop').addEventListener('pointerover', highlightMapItem);
    el('star-map-backdrop').addEventListener('focusin', highlightMapItem);
    el('star-map-backdrop').addEventListener('pointerleave', () => document.querySelectorAll('#star-map-backdrop .is-highlighted').forEach((item) => item.classList.remove('is-highlighted')));
    el('star-map-backdrop').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeStarMap(); }
      if (event.key === 'Tab') {
        const focusable = [...el('star-map-backdrop').querySelectorAll('button:not(:disabled)')].filter((item) => item.offsetParent !== null);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width && width !== lastWidth && el('star-map-backdrop').classList.contains('show')) {
        lastWidth = width;
        renderStarMap();
      }
    });
    observer.observe(el('star-map'));
  })();
`;
