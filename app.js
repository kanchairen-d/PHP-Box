/* php-box Admin — 事件委托版 */
(function() {
'use strict';

var API = 'api.php';
var STORAGE_THEME = 'phpbox_theme';
var edPath = '';
var fPath = '/';
var fSel = {};
var fCurRow = null;
var lTimer = null;

function $(id) { return document.getElementById(id); }
function qs(s, c) { return (c||document).querySelector(s); }
function qsa(s, c) { return (c||document).querySelectorAll(s); }

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s; return d.innerHTML;
}

function tt(msg, type) {
  if (!type) type = 'ok';
  var t = document.createElement('div');
  t.className = 'tt ' + type;
  t.textContent = msg;
  $('tt').appendChild(t);
  setTimeout(function() { t.remove(); }, 3500);
}

function jf(url, opts) {
  if (!opts) opts = {};
  var headers = {'Content-Type':'application/json'};
  if (opts.headers) Object.assign(headers, opts.headers);
  return fetch(url, Object.assign({credentials:'same-origin'}, opts, {headers: headers})).then(function(r) { return r.json(); });
}

/* ===== 主题 ===== */
function toggleTheme() {
  var dark = $('themeSwitch').checked;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem(STORAGE_THEME, dark ? 'dark' : 'light');
  if (edAce) edAce.setTheme(getAceTheme());
}
function initTheme() {
  var saved = localStorage.getItem(STORAGE_THEME) || 'light';
  $('themeSwitch').checked = saved === 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  if (edAce) edAce.setTheme(getAceTheme());
}

/* ===== Tab 切换 ===== */
function tab(el) {
  qsa('.top-nav a').forEach(function(a) { a.classList.remove('on'); });
  qsa('.page').forEach(function(p) { p.classList.remove('on'); });
  el.classList.add('on');
  var pg = $('pg-' + el.dataset.tab);
  if (pg) pg.classList.add('on');
  var t = el.dataset.tab;
  if (t === 'dash') loadDash();
  else if (t === 'files') loadFiles(fPath);
  else if (t === 'logs') lLoad();
}

/* ===== 仪表盘 ===== */
var dashCache = {};

function dashSet(id, val) {
  var el = $(id);
  if (!el) return;
  if (el.textContent !== String(val)) el.textContent = val;
}

async function loadDash() {
  try {
    var r = await jf(API + '?action=status');
    if (!r.ok || !r.current) return;
    var cur = r.current.current || 'php84';
    dashSet('navVer', cur === 'php74' ? 'PHP 7.4' : 'PHP 8.4');
    $('dDot').className = 'dot ' + (r.current.state === 'running' ? 'green' : 'red');
    dashSet('dStateTxt', r.current.state === 'running' ? '运行中' : (r.current.state || '未知'));
    $('dVerSelect').value = cur;
    dashSet('dVerInfo', cur === 'php74' ? 'PHP 7.4+' : 'PHP 8.4+');
    dashSet('dUptime', r.uptime || '-');
    var lb = $('dLoadBar');
    if (lb && r.load_pct !== undefined) {
      lb.style.width = r.load_pct + '%';
      lb.className = 'load-bar ' + (r.load_color || 'green');
    }
    var lp = $('dLoadPct');
    dashSet('dLoadPct', r.load_pct !== undefined ? r.load_pct + '%' : r.load || '-');
    dashSet('dMem', r.memory || '-');
    dashSet('dDisk', r.disk || '-');
    if (r.procs) {
      var ph = r.procs.map(function(p) {
        return '<div class="proc-row"><span class="proc-name">' + esc(p.name) + '</span><span class="proc-pid">PID ' + p.pid + '</span></div>';
      }).join('');
      if ($('dProcs').innerHTML !== ph) $('dProcs').innerHTML = ph;
    }
    // 加载 PHP 信息（仪表盘用）
    var pi = await jf(API + '?action=phpinfo');
    if (pi.ok) {
      var verStr = pi.version_string || '-';
      var shortVer = verStr.split(' ')[1] || (cur === 'php74' ? '7.4.33' : '8.4.x');
      dashSet('dVer', 'PHP ' + shortVer);
      dashSet('dPHPVer', verStr);
      var mods = pi.modules || [];
      dashSet('dPHPCnt', mods.length);
      dashSet('dPHPCnt2', mods.length);
      var mh = mods.map(function(m) { return '<span class="mtag">' + esc(m) + '</span>'; }).join('');
      if ($('dPHPMods').innerHTML !== mh) $('dPHPMods').innerHTML = mh;
    }
  } catch(e) { console.error('loadDash error', e); }
}

async function sw(ver) {
  var info = $('dVerInfo');
  info.textContent = '⏳ 切换中...';
  try {
    var r = await jf(API + '?action=switch', {method:'POST', body:JSON.stringify({version:ver})});
    if (r.ok) {
      var retries = 0;
      var poll = setInterval(async function() {
        retries++;
        var st = await jf(API + '?action=status');
        if (st.ok && st.current && st.current.current === ver) {
          clearInterval(poll);
          info.textContent = '✅ 已切换';
          setTimeout(function() { loadDash(); }, 1500);
        } else if (retries > 10) {
          clearInterval(poll);
          info.textContent = '❌ 切换超时';
          setTimeout(function() { loadDash(); }, 2000);
        }
      }, 1000);
    } else {
      info.textContent = '❌ ' + (r.error || '失败');
    }
  } catch(e) { info.textContent = '❌ 失败'; }
}

/* ===== 文件管理 ===== */
async function loadFiles(path) {
  if (!path) path = '/';
  fPath = path;
  $('fLo').style.display = 'block';
  $('fTb').innerHTML = '';
  $('fEm').style.display = 'none';
  fClearSel();
  try {
    var r = await jf(API + '?action=files&path=' + encodeURIComponent(path));
    $('fLo').style.display = 'none';
    if (!r.ok) { tt(r.error || '加载失败', 'err'); return; }
    var parts = path.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
    var bc = '<a data-p="/">主目录</a>';
    var acc = '';
    parts.forEach(function(p) {
      acc += '/' + p;
      bc += '<span class="sep">/</span><a data-p="' + esc(acc) + '">' + esc(p) + '</a>';
    });
    $('fBc').innerHTML = bc;
    var files = r.files || [];
    if (!files.length) { $('fEm').style.display = 'block'; return; }
    var html = '';
    files.forEach(function(f) {
      var icon = f.is_dir ? '📁' : '📄';
      var name = f.is_dir ? '<a class="flink" data-dir="' + esc(f.path) + '">' + esc(f.name) + '</a>' : esc(f.name);
      var isArc = !f.is_dir && (f.name.endsWith('.zip') || f.name.endsWith('.tar') || f.name.endsWith('.tar.gz') || f.name.endsWith('.tgz') || f.name.endsWith('.7z'));
      var rowPath = esc(f.path);
      var acts = '<div class="facts">';
      if (!f.is_dir) acts += '<button class="btn btn-sm" data-act="edit" data-path="' + esc(f.path) + '">✏️</button>';
      if (!f.is_dir) acts += '<button class="btn btn-sm" data-act="download" data-path="' + esc(f.path) + '">⬇️</button>';
      if (isArc) acts += '<button class="btn btn-sm" data-act="extract" data-path="' + esc(f.path) + '">📦</button>';
      acts += '<button class="btn btn-sm" data-act="delete" data-path="' + esc(f.path) + '" data-dir="' + (f.is_dir?'1':'0') + '">🗑</button></div>';
      html += '<tr data-path="' + rowPath + '" data-name="' + esc(f.name) + '" data-dir="' + (f.is_dir?'1':'0') + '"><td class="col-cb"><input type="checkbox" class="f-chk" value="' + rowPath + '" data-name="' + esc(f.name) + '"></td><td class="ficon">' + icon + '</td><td>' + name + '</td><td class="col-sz">' + (f.size_hr || '-') + '</td><td class="col-dt">' + (f.mtime_hr || '-') + '</td><td class="col-act">' + acts + '</td></tr>';
    });
    $('fTb').innerHTML = html;
  } catch(e) { $('fLo').style.display = 'none'; console.error(e); }
}

function fToggleAll(checked) {
  var cbs = qsa('.f-chk');
  cbs.forEach(function(cb) { cb.checked = checked; });
  fSel = {};
  if (checked) { cbs.forEach(function(cb) { fSel[cb.value] = cb.dataset.name; }); }
}
function fToggleOne(cb) {
  if (cb.checked) { fSel[cb.value] = cb.dataset.name; } else { delete fSel[cb.value]; var a = $('fChkAll'); if (a) a.checked = false; }
}
function fClearSel() {
  fSel = {}; var a = $('fChkAll'); if (a) a.checked = false;
  qsa('.f-chk').forEach(function(cb) { cb.checked = false; });
  qsa('.ft tbody tr.cur').forEach(function(r) { r.classList.remove('cur'); });
  fCurRow = null;
}
async function fDelSelected() {
  var keys = Object.keys(fSel);
  if (!keys.length) { tt('请先勾选要删除的文件', 'err'); return; }
  if (!confirm('确认删除选中的 ' + keys.length + ' 项？此操作不可恢复！')) return;
  try {
    var r = await jf(API + '?action=bulk_delete', {method:'POST', body:JSON.stringify({path: fPath, files: keys})});
    if (r.ok) { tt('已删除 ' + keys.length + ' 项'); fClearSel(); loadFiles(fPath); }
    else tt(r.error || '删除失败', 'err');
  } catch(e) { tt('删除失败', 'err'); }
}

/* ===== 上传（含分片） ===== */
function fmtSize(bytes) {
  if (bytes === 0) return '0 B';
  var u = ['B','KB','MB','GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i>0?1:0) + ' ' + u[i];
}

async function fuDo(e) {
  var files = e.target.files;
  if (!files.length) return;
  fUpload(files);
  e.target.value = '';
}

function addTaskUI(task) {
  var div = document.createElement('div');
  div.id = task.id;
  div.className = 'upload-task';
  div.style.cssText = 'font-size:13px';
  div.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span>' + esc(task.name) + ' <small style="color:var(--text-dim)">' + fmtSize(task.size) + '</small></span><span class="task-status">' + task.status + '</span></div>' +
    '<div style="height:4px;background:var(--border-l);border-radius:2px;overflow:hidden"><div class="task-bar" style="height:100%;width:0%;background:var(--accent);border-radius:2px;transition:width .2s"></div></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-top:2px"><span class="task-rate"></span><span class="task-eta"></span></div>';
  $('uploadTasks').appendChild(div);
}

function updateTaskUI(task) {
  var div = $(task.id);
  if (!div) return;
  var pct = task.size > 0 ? (task.uploaded / task.size * 100) : 0;
  qs('.task-bar', div).style.width = Math.min(pct, 100) + '%';
  qs('.task-status', div).textContent = task.status;
  if (task.rate) qs('.task-rate', div).textContent = task.rate;
  if (task.eta) qs('.task-eta', div).textContent = task.eta;
}

async function uploadSimple(file, task, path) {
  var fd = new FormData(); fd.append('file', file); fd.append('path', path);
  try {
    var xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        task.uploaded = e.loaded; task.status = '上传中 ' + Math.round(e.loaded/e.size*100) + '%';
        updateTaskUI(task);
      }
    };
    xhr.open('POST', API + '?action=upload');
    var d = await new Promise(function(resolve, reject) {
      xhr.onload = function() { resolve(JSON.parse(xhr.responseText)); };
      xhr.onerror = reject;
      xhr.send(fd);
    });
    if (d.ok) { task.status = '✅ 完成'; task.uploaded = file.size; updateTaskUI(task); loadFiles(fPath); }
    else { task.status = '❌ 失败: ' + (d.error||''); updateTaskUI(task); }
  } catch(e) { task.status = '❌ 失败'; updateTaskUI(task); }
  task.done = true;
}

async function uploadChunked(file, task, path) {
  var chunkSize = 5 * 1024 * 1024;
  var totalChunks = Math.ceil(file.size / chunkSize);
  try {
    var init = await jf(API + '?action=upload_chunk_init', {method:'POST', body:JSON.stringify({path:path, filename:file.name, total_size:file.size})});
    if (!init.ok) { task.status = '❌ 初始化失败'; updateTaskUI(task); task.done = true; return; }
    task.uploadId = init.upload_id;
    for (var ci = 0; ci < totalChunks; ci++) {
      var start = ci * chunkSize;
      var end = Math.min(start + chunkSize, file.size);
      var blob = file.slice(start, end);
      var fd = new FormData();
      fd.append('chunk', blob);
      fd.append('upload_id', task.uploadId);
      fd.append('chunk_index', ci);
      fd.append('chunk_size', blob.size);
      var d = await (await fetch(API + '?action=upload_chunk_part', {method:'POST', body:fd})).json();
      if (!d.ok) { task.status = '❌ 分片 ' + ci + ' 失败'; updateTaskUI(task); task.done = true; return; }
      task.uploaded = Math.min(end, file.size);
      task.status = '分片 ' + (ci+1) + '/' + totalChunks + ' ' + Math.round(task.uploaded/file.size*100) + '%';
      var speed = task.lastLoaded ? (task.uploaded - task.lastLoaded) / ((Date.now() - task.lastTime) / 1000) : 0;
      if (speed > 0) task.rate = fmtSize(speed) + '/s';
      task.lastLoaded = task.uploaded;
      task.lastTime = Date.now();
      updateTaskUI(task);
    }
    var finish = await jf(API + '?action=upload_chunk_finish', {method:'POST', body:JSON.stringify({upload_id:task.uploadId, path:path, filename:file.name})});
    if (finish.ok) { task.status = '✅ 完成'; task.uploaded = file.size; updateTaskUI(task); loadFiles(fPath); }
    else { task.status = '❌ 合并失败: ' + (finish.error||''); updateTaskUI(task); }
  } catch(e) { task.status = '❌ 上传异常'; updateTaskUI(task); }
  task.done = true;
}

async function fUpload(files) {
  $('uploadPanel').style.display = 'block';
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var taskId = 'task_' + Date.now() + '_' + i;
    var task = {id: taskId, name: file.name, size: file.size, uploaded: 0, status: '上传中', rate: '', eta: '', paused: false, done: false, xhr: null};
    addTaskUI(task);
    if (file.size > 50 * 1024 * 1024) {
      await uploadChunked(file, task, fPath);
    } else {
      await uploadSimple(file, task, fPath);
    }
  }
  tt('全部上传完成');
  setTimeout(function() { $('uploadPanel').style.display = 'none'; $('uploadTasks').innerHTML = ''; }, 3000);
}

async function fDel(path, isDir) {
  var name = path.split('/').pop();
  if (!confirm('确定删除 ' + name + '？' + (isDir ? '（目录及内容将全部删除）' : ''))) return;
  try {
    var r = await jf(API + '?action=delete', {method:'POST', body:JSON.stringify({path: path})});
    if (r.ok) { tt('已删除'); loadFiles(fPath); }
    else tt(r.error || '删除失败', 'err');
  } catch(e) { tt('删除失败', 'err'); }
}

/* ===== 重命名 ===== */
function fRename() {
  var keys = Object.keys(fSel);
  if (keys.length !== 1) { tt('请勾选一个文件/文件夹重命名', 'err'); return; }
  var oldName = fSel[keys[0]];
  var newName = prompt('输入新名称：', oldName);
  if (!newName || newName === oldName) return;
  if (newName.indexOf('/') >= 0) { tt('名称不能包含 /', 'err'); return; }
  jf(API + '?action=rename', {method:'POST', body:JSON.stringify({path: fPath, old_name: oldName, new_name: newName})})
  .then(function(r) {
    if (r.ok) { tt('已重命名'); fClearSel(); loadFiles(fPath); }
    else tt(r.error || '重命名失败', 'err');
  });
}

/* ===== 编辑器 ===== */
// Ace Editor 相关
var edAce = null;
var edSearch = null;

function aceModeByExt(name) {
  var s = (name || '').toLowerCase();
  var map = {
    js:'javascript', ts:'typescript', vue:'vue', html:'html', htm:'html',
    css:'css', json:'json', md:'markdown', markdown:'markdown', yml:'yaml', yaml:'yaml',
    xml:'xml', sh:'sh', py:'python', rb:'ruby', go:'golang',
    php:'php', java:'java', c:'c_cpp', cpp:'c_cpp', h:'c_cpp',
    csv:'text', txt:'text', ini:'ini', conf:'ini', log:'text', m3u:'text', m3u8:'text'
  };
  var ext = s.split('.').pop();
  return map[ext] || 'text';
}

function getAceTheme() {
  var dt = document.documentElement.getAttribute('data-theme');
  return dt === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome';
}

function initAce() {
  if (!edAce) {
    edAce = ace.edit('aceEditor');
    edAce.setOptions({
      fontSize: 14,
      showPrintMargin: false,
      wrap: true,
      highlightSelectedWord: true
    });
    edAce.setTheme(getAceTheme());
    edAce.commands.addCommand({
      name: 'openFind',
      bindKey: {win: 'Ctrl-F', mac: 'Command-F'},
      exec: function(ed) { ed.execCommand('find'); }
    });
    edAce.commands.addCommand({
      name: 'openReplace',
      bindKey: {win: 'Ctrl-H', mac: 'Command-Option-F'},
      exec: function(ed) { ed.execCommand('replace'); }
    });
    // Search engine
    if (!edSearch) {
      var Search = ace.require('ace/search').Search;
      edSearch = new Search();
    }
  }
}

async function fEdit(path) {
  try {
    var r = await jf(API + '?action=read&path=' + encodeURIComponent(path));
    if (!r.ok) { tt(r.error || '读取失败', 'err'); return; }
    edPath = path;
    $('edTitle').textContent = '编辑: ' + path;
    $('edOverlay').style.display = 'flex';
    // 初始化 Ace
    initAce();
    edAce.session.setMode('ace/mode/' + aceModeByExt(path));
    edAce.setValue(r.content || '', -1);
    edAce.session.getUndoManager().reset();
    edAce.clearSelection();
    $('edInfo').textContent = (r.content || '').split('\n').length + ' 行';
    // 触发 Ace 自适应
    setTimeout(function() { if (edAce) edAce.resize(); }, 50);
    // 重置弹窗位置大小
    var d = $('edDialog');
    d.style.position = '';
    d.style.left = '';
    d.style.top = '';
    d.style.margin = '';
    d.style.width = '';
    d.style.height = '';
    d.style.maxWidth = '';
    // 清空搜索
    $('edSearch').value = '';
    $('edReplace').value = '';
    $('edMatchInfo').textContent = '';
    clearSearchMarkers();
    edAce.focus();
  } catch(e) { tt('读取失败', 'err'); }
}

function edSave() {
  if (!edPath) return;
  var content = edAce ? edAce.getValue() : '';
  $('edInfo').textContent = '保存中...';
  jf(API + '?action=write', {method:'POST', body:JSON.stringify({path: edPath, content: content})})
    .then(function(r) {
      if (r.ok) { tt('已保存'); $('edInfo').textContent = content.split('\n').length + ' 行'; }
      else { tt('保存失败: ' + (r.error || ''), 'err'); $('edInfo').textContent = '保存失败'; }
    });
}
function edClose() { $('edOverlay').style.display = 'none'; }

// ===== 查找替换 =====
var edMarkers = [];

function clearSearchMarkers() {
  if (!edAce) return;
  var s = edAce.session;
  edMarkers.forEach(function(id) {
    try { s.removeMarker(id); } catch(e) {}
  });
  edMarkers = [];
}

function liveSearch() {
  if (!edAce || !edSearch) return;
  clearSearchMarkers();
  var needle = $('edSearch').value;
  if (!needle) { $('edMatchInfo').textContent = ''; return; }
  var isRegex = $('edRegex').checked;
  if (isRegex) {
    try { new RegExp(needle); } catch(e) {
      $('edMatchInfo').textContent = '⚠ 无效正则';
      return;
    }
  }
  edSearch.setOptions({
    needle: needle,
    caseSensitive: $('edCase').checked,
    wholeWord: $('edWord').checked,
    regExp: isRegex
  });
  var ranges = [];
  try { ranges = edSearch.findAll(edAce.session) || []; } catch(e) {}
  $('edMatchInfo').textContent = '匹配: ' + ranges.length + ' 条';
  ranges.forEach(function(r, idx) {
    var klass = idx === 0 ? 'ace_multi_match-current' : 'ace_multi_match';
    var id = edAce.session.addMarker(r, klass, 'text', false);
    edMarkers.push(id);
  });
  if (ranges[0]) edAce.scrollToLine(ranges[0].start.row, true, true, function(){});
}

function doFind(dir) {
  if (!edAce || !$('edSearch').value) return;
  var opts = {
    needle: $('edSearch').value,
    wrap: true,
    caseSensitive: $('edCase').checked,
    wholeWord: $('edWord').checked,
    regExp: $('edRegex').checked,
    backwards: dir < 0
  };
  edAce.find($('edSearch').value, opts);
  edAce.centerSelection();
  liveSearch();
}

function doReplaceOnce() {
  if (!edAce || !$('edSearch').value) return;
  edAce.find($('edSearch').value, {
    needle: $('edSearch').value,
    wrap: true,
    caseSensitive: $('edCase').checked,
    wholeWord: $('edWord').checked,
    regExp: $('edRegex').checked,
    backwards: false
  });
  edAce.replace($('edReplace').value || '');
  liveSearch();
}

function doReplaceAll() {
  if (!edAce || !$('edSearch').value) return;
  edAce.find($('edSearch').value, {
    needle: $('edSearch').value,
    wrap: true,
    caseSensitive: $('edCase').checked,
    wholeWord: $('edWord').checked,
    regExp: $('edRegex').checked,
    backwards: false
  });
  edAce.replaceAll($('edReplace').value || '');
  liveSearch();
  tt('全部替换完成');
}

/* ===== 新建 ===== */
function showNewDialog() {
  $('newOverlay').style.display = 'flex';
  $('newName').value = '';
  $('newTypeFile').checked = true;
  $('newName').focus();
}
function newClose() { $('newOverlay').style.display = 'none'; }
function newCreate() {
  var name = $('newName').value.trim();
  var type = $('newTypeFile').checked ? 'file' : 'dir';
  if (!name) { tt('请输入名称', 'err'); return; }
  if (type === 'file') {
    jf(API + '?action=write', {method:'POST', body:JSON.stringify({path: fPath + '/' + name, content: ''})})
      .then(function(r) { if(r.ok){tt('已创建文件');newClose();loadFiles(fPath);} else tt('创建失败: '+r.error,'err'); });
  } else {
    jf(API + '?action=mkdir', {method:'POST', body:JSON.stringify({path: fPath + '/' + name})})
      .then(function(r) { if(r.ok){tt('已创建文件夹');newClose();loadFiles(fPath);} else tt('创建失败: '+r.error,'err'); });
  }
}

/* ===== 解压 ===== */
async function fExtract(path) {
  var name = path.split('/').pop();
  try {
    var r = await jf(API + '?action=extract', {method:'POST', body:JSON.stringify({path: fPath, filename: name, password: ''})});
    if (r.ok) { tt('解压完成: ' + name); return true; }
    else { tt(r.error || '解压失败: ' + name, 'err'); return false; }
  } catch(e) { tt('解压失败: ' + name, 'err'); return false; }
}

async function fExtractSelected() {
  var keys = Object.keys(fSel);
  if (!keys.length) { tt('请先勾选要解压的文件', 'err'); return; }
  var toExtract = [];
  var invalid = [];
  var extRE = /\.(zip|tar\.gz|tgz|tar|7z)$/i;
  keys.forEach(function(p) {
    if (extRE.test(p)) toExtract.push(p);
    else invalid.push(p.split('/').pop());
  });
  if (toExtract.length === 0) {
    tt('勾选的文件中没有压缩包（支持 .zip/.tar/.tar.gz/.tgz/.7z）', 'err');
    return;
  }
  if (invalid.length) {
    tt('⚠️ 以下文件不是压缩包，已跳过: ' + invalid.slice(0,5).join(', ') + (invalid.length>5?'...':''), 'err');
  }
  if (!confirm('解压 ' + toExtract.length + ' 个压缩包到当前目录？')) return;
  for (var i = 0; i < toExtract.length; i++) {
    await fExtract(toExtract[i]);
  }
  fClearSel();
  loadFiles(fPath);
}

/* ===== PHP 信息 ===== */
async function loadPHPInfo() {
  try {
    var r = await jf(API + '?action=phpinfo');
    if (!r.ok) { $('piMeta').textContent = '加载失败'; return; }
    $('piVer').textContent = r.current_version === 'php74' ? 'PHP 7.4+' : (r.current_version === 'php84' ? 'PHP 8.4+' : r.current_version || '-');
    $('piMeta').innerHTML = '<div style="margin-bottom:8px"><strong>版本:</strong> ' + esc(r.version_string || '-') + '</div>';
    var mods = r.modules || [];
    $('piCnt').textContent = mods.length;
    $('piMods').innerHTML = mods.map(function(m) { return '<span class="mtag">' + esc(m) + '</span>'; }).join('');
  } catch(e) { $('piMeta').textContent = '加载失败'; }
}

/* ===== 日志 ===== */
async function lLoad() {
  var t = $('lType').value, n = $('lLines').value;
  try {
    var r = await jf(API + '?action=logs&type=' + t + '&lines=' + n);
    $('lOut').textContent = r.ok ? (r.content || '(空)') : (r.error || '加载失败');
  } catch(e) { $('lOut').textContent = '加载失败'; }
}
function lClear() { $('lOut').textContent = ''; }
function lAutoToggle() {
  if (lTimer) { clearInterval(lTimer); lTimer = null; return '▶ 自动'; }
  lLoad();
  lTimer = setInterval(lLoad, 5000);
  return '⏹ 停止';
}

/* ===== 事件委托 ===== */
document.addEventListener('click', function(e) {
  var el = e.target;
  
  // Nav tabs
  if (el.matches('.top-nav a')) {
    tab(el);
    return;
  }
  
  // Breadcrumbs
  if (el.matches('.bc a')) {
    loadFiles(el.dataset.p);
    return;
  }
  
  // Directory links in file table
  if (el.matches('.flink')) {
    loadFiles(el.dataset.dir);
    return;
  }
  
  // 目录选择器浏览
  if (el.matches('.dc-item') || el.matches('#dcBc a')) {
    var p = (el.matches('.dc-item') ? el.dataset.dc : el.dataset.dc) || '/';
    loadDCDirs(p);
    return;
  }
  
  // Row highlight（单文件移动用）— 排除按钮/checkbox/链接
  if (!el.closest('button') && !el.closest('input') && !el.closest('a') && (el.matches('.ft tbody tr') || el.closest('.ft tbody tr'))) {
    var tr = el.matches('.ft tbody tr') ? el : el.closest('.ft tbody tr');
    if (tr && tr.dataset.path) {
      qsa('.ft tbody tr.cur').forEach(function(r) { r.classList.remove('cur'); });
      tr.classList.add('cur');
      fCurRow = tr.dataset.path;
    }
  }

  // Checkboxes
  if (el.matches('.f-chk')) {
    fToggleOne(el);
    return;
  }
  if (el.matches('#fChkAll')) {
    fToggleAll(el.checked);
    return;
  }
  
  // Actions
  var act = el.dataset.act;
  if (!act) {
    // Check parent buttons
    el = el.closest('[data-act]');
    if (!el) return;
    act = el.dataset.act;
  }
  
  switch (act) {
    case 'upload': $('fuIn').click(); break;
    case 'new': showNewDialog(); break;
    case 'rename': fRename(); break;
    case 'edit': fEdit(el.dataset.path); break;
    case 'download':
      window.open(API + '?action=download&path=' + encodeURIComponent(fPath) + '&filename=' + encodeURIComponent(el.dataset.path.split('/').pop()), '_blank');
      break;
    case 'extractup': fExtractSelected(); break;
    case 'move': showDirChooser(false); break;
    case 'bulkmove': showDirChooser(true); break;
    case 'archive': showArchiveDialog(); break;
    case 'filedel': fDelSelected(); break;
    case 'extract': fExtract(el.dataset.path); break;
    case 'delete': fDel(el.dataset.path, el.dataset.dir === '1'); break;
    case 'logref': lLoad(); break;
    case 'logauto': el.textContent = lAutoToggle(); break;
    case 'logclear': lClear(); break;
  }
});

// File input change
$('fuIn').addEventListener('change', fuDo);
// ===== 解压对话框 =====


/* ===== 创建压缩包 ===== */
/* ===== 目录选择器（移动） ===== */
var dcPath = '/';
var dcFiles = null; // 在弹窗打开时锁定要移动的文件

function showDirChooser(isBulk) {
  if (!isBulk) {
    var mvPath = fCurRow || (Object.keys(fSel).length === 1 ? Object.keys(fSel)[0] : null);
    if (!mvPath) { tt('请先点击选择或勾选一个文件/文件夹', 'err'); return; }
    dcFiles = [mvPath];
  } else {
    var keys = Object.keys(fSel);
    if (!keys.length) { tt('请先勾选要移动的文件', 'err'); return; }
    dcFiles = keys;
  }
  dcPath = '/';
  $('dcTitle').textContent = '📂 ' + (isBulk ? '批量' : '') + '选择目标目录';
  $('dcOverlay').style.display = 'flex';
  loadDCDirs('/');
  $('dcOverlay').dataset.bulk = isBulk ? '1' : '0';
}

function loadDCDirs(path) {
  dcPath = path || '/';
  $('dcCurTarget').textContent = '📌 目标: ' + (path === '/' ? '主目录' : path);
  jf(API + '?action=files&path=' + encodeURIComponent(path)).then(function(r) {
    if (!r.ok || !r.files) { $('dcList').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">加载失败</div>'; return; }
    var parts = (path || '/').replace(/^\/|\/$/g, '').split('/').filter(Boolean);
    var bc = '<a data-dc="/">主目录</a>';
    var acc = '';
    parts.forEach(function(p) {
      acc += '/' + p;
      bc += '<span class="sep" style="color:var(--text-dim);padding:0 4px">/</span><a data-dc="' + esc(acc) + '">' + esc(p) + '</a>';
    });
    $('dcBc').innerHTML = bc;
    var dirs = r.files.filter(function(f) { return f.is_dir; });
    if (!dirs.length) {
      $('dcList').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">📂 没有子目录</div>';
      return;
    }
    $('dcList').innerHTML = dirs.map(function(f) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 18px;cursor:pointer;border-radius:4px;font-size:14px;transition:background .12s" class="dc-item" data-dc="' + esc(f.path) + '" onmouseover="this.style.background=\'rgba(128,128,128,0.08)\'" onmouseout="this.style.background=\'\'">📁 ' + esc(f.name) + '</div>';
    }).join('');
  });
}

function dcConfirm() {
  if (!dcFiles || !dcFiles.length) { tt('请选择文件', 'err'); return; }
  var target = dcPath === '/' ? '' : dcPath;
  jf(API + '?action=move', {method:'POST', body:JSON.stringify({files: dcFiles, target: target})})
  .then(function(r) {
    $('dcOverlay').style.display = 'none';
    if (r.ok) {
      if (r.moved && r.moved.length) { tt('已移动 ' + r.moved.length + ' 项'); }
      else if (r.errors && r.errors.length) { tt(r.errors.join(', '), 'err'); return; }
      else { tt('移动完成', 'ok'); }
    } else { tt(r.errors ? r.errors.join(', ') : '移动失败', 'err'); return; }
    fCurRow = null; qsa('.ft tbody tr.cur').forEach(function(x){x.classList.remove('cur');}); fClearSel(); loadFiles(fPath);
  });
}

function showArchiveDialog() {
  var keys = Object.keys(fSel);
  if (!keys.length) { tt('请先勾选要压缩的文件', 'err'); return; }
  $('arcName').value = 'archive.zip';
  $('arcFormat').value = 'zip';
  $('arcPass').value = '';
  $('archiveOverlay').style.display = 'flex';
}

function doArchive() {
  var keys = Object.keys(fSel);
  var name = $('arcName').value.trim();
  var format = $('arcFormat').value;
  var password = $('arcPass').value;
  if (!name) { tt('请输入文件名', 'err'); return; }
  $('arcDoBtn').textContent = '⏳ 创建中...';
  $('arcDoBtn').disabled = true;
  jf(API + '?action=archive', {method:'POST', body:JSON.stringify({path: fPath, files: keys, archive_name: name, format: format, password: password})})
    .then(function(r) {
      $('arcDoBtn').textContent = '📦 创建';
      $('arcDoBtn').disabled = false;
      if (r.ok) { tt('压缩包已创建: ' + name); $('archiveOverlay').style.display = 'none'; fClearSel(); loadFiles(fPath); }
      else tt(r.error || '创建失败', 'err');
    });
}

// Save & Close
function edSaveClose() {
  edSave();
  edClose();
}

// Version switch
$('dVerSelect').addEventListener('change', function() { sw(this.value); });

// Log type/lines change
$('lType').addEventListener('change', lLoad);
$('lLines').addEventListener('change', lLoad);

// Theme switch
$('themeSwitch').addEventListener('change', toggleTheme);

// Editor
$('edSaveBtn').addEventListener('click', edSave);
$('edSaveCloseBtn').addEventListener('click', edSaveClose);
$('edCloseBtn').addEventListener('click', edClose);
$('edCancelBtn').addEventListener('click', edClose);

// 查找替换事件
// 弹窗拖拽 + 缩放（统一处理）
var edDrag = false, edResize = false;
(function() {
  var dlg = $('edDialog');
  var bar = $('edTitleBar');
  var handle = $('edResizeHandle');
  var startX, startY, startW, startH, startL, startT;

  bar.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    edDrag = true;
    startX = e.clientX; startY = e.clientY;
    startL = dlg.offsetLeft || 0; startT = dlg.offsetTop || 0;
    dlg.style.position = 'fixed';
    dlg.style.left = startL + 'px';
    dlg.style.top = startT + 'px';
    dlg.style.margin = '0';
  });

  handle.addEventListener('mousedown', function(e) {
    edResize = true;
    e.stopPropagation();
    e.preventDefault();
    startX = e.clientX; startY = e.clientY;
    startW = dlg.offsetWidth; startH = dlg.offsetHeight;
  });

  document.addEventListener('mousemove', function(e) {
    if (edDrag) {
      dlg.style.left = (startL + e.clientX - startX) + 'px';
      dlg.style.top = (startT + e.clientY - startY) + 'px';
    }
    if (edResize) {
      var nw = Math.max(400, startW + e.clientX - startX);
      var nh = Math.max(260, startH + e.clientY - startY);
      dlg.style.width = nw + 'px';
      dlg.style.maxWidth = 'none';
      dlg.style.height = nh + 'px';
      if (edAce) edAce.resize();
    }
  });

  document.addEventListener('mouseup', function() {
    if (edResize) {
      if (edAce) edAce.resize();
      edResize = true;
      setTimeout(function() { edResize = false; }, 300);
    }
    edDrag = false;
  });
})();

$('edSearch').addEventListener('input', liveSearch);
$('edCase').addEventListener('change', liveSearch);
$('edWord').addEventListener('change', liveSearch);
$('edRegex').addEventListener('change', liveSearch);
$('edFindPrev').addEventListener('click', function() { doFind(-1); });
$('edFindNext').addEventListener('click', function() { doFind(1); });
$('edReplaceOnce').addEventListener('click', doReplaceOnce);
$('edReplaceAll').addEventListener('click', doReplaceAll);



// Archive overlay
$('dcCloseBtn').addEventListener('click', function() { $('dcOverlay').style.display = 'none'; });
$('dcCancelBtn').addEventListener('click', function() { $('dcOverlay').style.display = 'none'; });
$('dcConfirmBtn').addEventListener('click', dcConfirm);
$('dcOverlay').addEventListener('click', function(e) { if (e.target === this) this.style.display = 'none'; });

$('arcCancelBtn').addEventListener('click', function() { $('archiveOverlay').style.display = 'none'; });
$('arcDoBtn').addEventListener('click', doArchive);
$('archiveOverlay').addEventListener('click', function(e) { if (e.target === this) this.style.display = 'none'; });
$('arcName').addEventListener('keydown', function(e) { if (e.key === 'Enter') doArchive(); });
$('arcFormat').addEventListener('change', function() {
  var fmt = this.value;
  var name = $('arcName').value;
  var ext = '.' + fmt;
  if (fmt === 'tgz') ext = '.tar.gz';
  $('arcName').value = name.replace(/\.(zip|7z|tar|tar\.gz|tgz)$/i, '') + ext;
});
$('edOverlay').addEventListener('click', function(e) {
  if (e.target === this && !edDrag && !edResize) edClose();
});
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    if ($('edOverlay').style.display === 'flex') { e.preventDefault(); edSave(); }
  }
});

// New dialog
$('newCloseBtn').addEventListener('click', newClose);
$('newCancelBtn').addEventListener('click', newClose);
$('newCreateBtn').addEventListener('click', newCreate);
$('newOverlay').addEventListener('click', function(e) {
  if (e.target === this) newClose();
});
$('newName').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') newCreate();
});

// Mobile sidebar close (keep for compatibility)
document.addEventListener('click', function(e) {
  // No-op for now, nav is top bar
});

// 轻量仪表盘刷新（仅刷新状态数据，不重载 PHP 信息）
async function refreshDashStatus() {
  try {
    var r = await jf(API + '?action=status');
    if (!r.ok || !r.current) return;
    dashSet('dUptime', r.uptime || '-');
    dashSet('dStateTxt', r.current.state === 'running' ? '运行中' : (r.current.state || '未知'));
    var lb = $('dLoadBar');
    if (lb && r.load_pct !== undefined) {
      lb.style.width = r.load_pct + '%';
      lb.className = 'load-bar ' + (r.load_color || 'green');
    }
    dashSet('dLoadPct', r.load_pct !== undefined ? r.load_pct + '%' : r.load || '-');
    dashSet('dMem', r.memory || '-');
    dashSet('dDisk', r.disk || '-');
    if (r.procs) {
      var ph = r.procs.map(function(p) {
        return '<div class="proc-row"><span class="proc-name">' + esc(p.name) + '</span><span class="proc-pid">PID ' + p.pid + '</span></div>';
      }).join('');
      if ($('dProcs').innerHTML !== ph) $('dProcs').innerHTML = ph;
    }
  } catch(e) {}
}

/* ===== 设置 ===== */
$('settingsBtn').addEventListener('click', function() {
  $('setOverlay').style.display = 'flex';
  $('setOldUser').value = '';
  $('setOldPass').value = '';
  $('setNewUser').value = '';
  $('setNewPass').value = '';
  $('setErr').style.opacity = '0';
  $('setOldUser').focus();
});
$('setCloseBtn').addEventListener('click', function() { $('setOverlay').style.display = 'none'; });
$('setCancelBtn').addEventListener('click', function() { $('setOverlay').style.display = 'none'; });
$('setSaveBtn').addEventListener('click', async function() {
  var oldU = $('setOldUser').value.trim();
  var oldP = $('setOldPass').value;
  var newU = $('setNewUser').value.trim();
  var newP = $('setNewPass').value;
  if (!oldU || !oldP || !newU || !newP) {
    $('setErr').textContent = '请填写完整';
    $('setErr').style.opacity = '1';
    return;
  }
  $('setSaveBtn').disabled = true;
  $('setSaveBtn').textContent = '⏳ 保存中...';
  try {
    var r = await jf(API + '?action=change_credentials', {method:'POST', body:JSON.stringify({old_username:oldU, old_password:oldP, new_username:newU, new_password:newP})});
    if (r.ok) {
      tt('✅ 账号密码已更新，请重新登录');
      $('setOverlay').style.display = 'none';
      // 强制重新登录
      await jf(API + '?action=logout', {method:'POST'});
      showLogin();
    } else {
      $('setErr').textContent = r.error || '修改失败';
      $('setErr').style.opacity = '1';
    }
  } catch(e) {
    $('setErr').textContent = '网络错误';
    $('setErr').style.opacity = '1';
  }
  $('setSaveBtn').disabled = false;
  $('setSaveBtn').textContent = '💾 保存';
});

/* ===== 退出 ===== */
$('logoutBtn').addEventListener('click', async function() {
  try {
    var r = await jf(API + '?action=logout', {method:'POST'});
    if (r.ok) showLogin();
  } catch(e) {}
});

/* ===== 登录 ===== */
function showLogin() {
  $('loginOverlay').classList.add('show');
  $('mainCard').style.display = 'none';
  $('topBar').classList.remove('show');
  $('loginUser').focus();
  $('loginErr').textContent = '';
  $('loginErr').className = 'login-err';
}
function hideLogin() {
  $('loginOverlay').classList.remove('show');
  $('mainCard').style.display = 'block';
  $('topBar').classList.add('show');
}

$('loginBtn').addEventListener('click', async function() {
  var u = $('loginUser').value.trim();
  var p = $('loginPass').value;
  if (!u || !p) { showLoginErr('请输入用户名和密码'); return; }
  $('loginBtn').textContent = '⏳ 登录中...';
  $('loginBtn').disabled = true;
  try {
    var r = await jf(API + '?action=login', {method:'POST', body:JSON.stringify({username:u, password:p})});
    if (r.ok) {
      hideLogin();
      loadDash();
    } else {
      showLoginErr(r.error || '登录失败');
    }
  } catch(e) {
    showLoginErr('网络错误');
  }
  $('loginBtn').textContent = '登 录';
  $('loginBtn').disabled = false;
});
$('loginPass').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('loginBtn').click(); });
$('loginUser').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('loginPass').focus(); });
$('setNewPass').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('setSaveBtn').click(); });

function showLoginErr(msg) {
  $('loginErr').textContent = msg;
  $('loginErr').className = 'login-err show';
}

/* ===== 启动 ===== */
initTheme();

// 检查登录
(async function() {
  try {
    var r = await jf(API + '?action=check_login');
    if (r.authenticated) {
      $('mainCard').style.display = 'block';
      $('topBar').classList.add('show');
      loadDash();
      setInterval(refreshDashStatus, 30000);
    } else {
      showLogin();
    }
  } catch(e) {
    showLogin();
  }
})();

// Load files on first tab visit
// Default tab is dash, files loaded on click

})();