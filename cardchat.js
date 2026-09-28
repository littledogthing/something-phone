/* ============================================================================
 * cardchat.js — 字卡聊天（EPhone / 兔K機 外掛 App）
 * ---------------------------------------------------------------------------
 * 靈感來源：Mochi 字卡 · 小紅書 @言序（1842523578）
 * 本檔為獨立重寫，未複製 Mochi 原始碼。
 * ---------------------------------------------------------------------------
 * 設計原則
 *   1. 完全獨立：自己的 Dexie 資料庫 CardChatDB，不碰 GeminiChatDB。
 *      角色、字卡、訊息全部自成一套，宿主更新或壞掉都不影響這裡。
 *   2. 自我注入：畫面與桌面圖示由本檔在載入時自己建立，
 *      index.html 只需要加一行 <script src="cardchat.js" defer></script>。
 *   3. 不用 AI：角色的回覆一律從字卡池抽，不呼叫任何 API、不花 token。
 *   4. 視覺沿用宿主：重用 .screen / .header / CSS 變數，看起來像內建功能。
 * ==========================================================================*/
(function () {
  'use strict';

  var SCREEN_ID = 'cardchat-screen';
  var DB_NAME = 'CardChatDB';
  var APP_LABEL = '字卡聊天';

  /* ========================================================================
   * 預設字卡庫（示範用，語氣已依「不帶語氣詞、不帶地域腔」的標準重寫）
   * 正式版會換成完整的 5,619 張。
   * ======================================================================*/
  var SEED = {
    '生活碎片': [
      '剛剛整理了一下桌子', '把昨天的衣服收了', '窗外有人在遛狗',
      '換了一組床單', '剛把垃圾拿出去', '桌上的杯子又空了',
      '剛剛發現抽屜裡還有一包餅乾', '把書架重新排了一次',
      '剛剛在陽台站了一會', '燈泡好像快不行了', '收到一個包裹，是上週買的',
      '剛剛把行事曆翻到下個月', '牆上的日曆忘記撕了', '剛擦完地板',
      '手機只剩百分之十五', '把窗戶打開透氣', '椅子坐久了有點硬',
      '剛剛整理相簿，翻到很久以前的照片'
    ],
    '我的一天': [
      '今天起得比平常早', '早上出門的時候路上很空', '上午的事情比想像中順利',
      '中午沒什麼胃口', '下午整個人都很鈍', '開了一個很長的會',
      '剛剛才忙完', '今天一整天都在跑來跑去', '晚上比較有空',
      '今天比昨天好一點', '剛回到家', '今天什麼都沒做成',
      '下午睡了一下，結果更累', '今天時間過得特別慢', '剛洗完澡',
      '準備收工了'
    ],
    '吃東西': [
      '中午吃了麵', '剛剛煮了東西吃', '買了一杯咖啡',
      '冰箱裡沒東西了', '今天想吃點清淡的', '剛剛吃太飽',
      '晚餐還沒決定', '樓下那家今天沒開', '買了水果回來',
      '剛剛喝了一杯水', '泡了一杯茶', '昨天的剩菜熱來吃',
      '好像有點餓了', '早餐只吃了一半', '買到很好吃的麵包'
    ],
    '天氣': [
      '外面開始下雨了', '今天風很大', '天氣轉涼了',
      '太陽很大，出門記得遮一下', '剛剛雨停了', '今天的空氣很乾',
      '早上起來霧很重', '晚上比白天冷很多', '衣服曬不乾',
      '今天悶悶的', '天空的顏色很好看', '好像要變天了'
    ],
    '關心你': [
      '你今天忙嗎', '記得喝水', '別坐太久',
      '事情做完再休息', '吃飯了嗎', '不要撐太晚',
      '今天過得怎麼樣', '累的話就先放著', '晚點再處理也可以',
      '你聲音聽起來有點累', '有好好吃東西嗎', '早點睡',
      '需要的話跟我說', '別把自己逼太緊'
    ],
    '隨口回應': [
      '嗯', '我在', '知道了',
      '好', '我看看', '原來是這樣',
      '真的假的', '我也這樣覺得', '有道理',
      '還不錯', '沒想到', '那還好',
      '我懂', '可以', '聽起來不錯',
      '再說吧'
    ],
    '想你': [
      '剛剛突然想到你', '在做什麼', '有點想找你說話',
      '今天想起你說過的一句話', '不知道你那邊現在幾點',
      '看到一個東西覺得你會喜歡', '有空的話聊一下',
      '你最近好像很忙', '想聽你說說今天的事', '沒事，就是想找你'
    ]
  };

  /* ========================================================================
   * 小工具
   * ======================================================================*/
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var uid = function (p) {
    return p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var rnd = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var hhmm = function (ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'cc-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 250);
    }, 1800);
  }

  /* ========================================================================
   * 資料層 — 獨立 Dexie 資料庫
   * ======================================================================*/
  var db = null;
  var DEFAULT_CFG = {
    multiProb: 30,   // 多字卡回覆機率（%）：一次連發 2~3 張
    cutProb: 12,     // 撤回式截斷機率（%）：句子說到一半停住
    delayMin: 700,   // 回覆延遲下限（ms）
    delayMax: 2000,  // 回覆延遲上限（ms）
    offGroups: []    // 被關閉的分組名
  };
  var cfg = Object.assign({}, DEFAULT_CFG);

  function openDB() {
    if (typeof Dexie === 'undefined') {
      throw new Error('Dexie 尚未載入，cardchat.js 必須放在 dexie.js 之後');
    }
    db = new Dexie(DB_NAME);
    db.version(1).stores({
      chars: '&id, name',
      cards: '++id, grp',
      msgs: '++id, charId, ts',
      meta: '&k'
    });
    return db.open();
  }

  async function loadCfg() {
    var row = await db.meta.get('cfg');
    cfg = Object.assign({}, DEFAULT_CFG, (row && row.v) || {});
    if (!Array.isArray(cfg.offGroups)) cfg.offGroups = [];
  }
  async function saveCfg() {
    await db.meta.put({ k: 'cfg', v: cfg });
  }

  async function seedIfEmpty() {
    var n = await db.cards.count();
    if (n > 0) return;
    var rows = [];
    Object.keys(SEED).forEach(function (grp) {
      SEED[grp].forEach(function (text) { rows.push({ grp: grp, text: text }); });
    });
    await db.cards.bulkAdd(rows);
  }

  /* ========================================================================
   * 回覆引擎
   * ------------------------------------------------------------------------
   * 只保留兩種行為：
   *   多字卡回覆 — 一次連發 2~3 張，每張一顆氣泡
   *   撤回式截斷 — 句子說到一半停住，模擬打字打到一半改變主意
   * 截斷後的句子「不入庫」，不會污染字卡庫。
   * ======================================================================*/
  var pool = [];   // 目前可抽的字卡文字（已排除關閉的分組）

  async function rebuildPool() {
    var all = await db.cards.toArray();
    pool = all
      .filter(function (c) { return cfg.offGroups.indexOf(c.grp) === -1; })
      .map(function (c) { return c.text; });
  }

  // 撤回式截斷：保留前 40%~80%，砍掉句尾標點
  function cutTail(text) {
    var s = String(text || '');
    if (s.length < 6) return s;
    var keep = Math.max(3, Math.floor(s.length * (0.4 + Math.random() * 0.4)));
    return s.slice(0, keep).replace(/[，。、？！~…,.?!]+$/, '');
  }

  function drawOne() {
    if (!pool.length) return null;
    var t = rnd(pool);
    if (Math.random() * 100 < cfg.cutProb) {
      var c = cutTail(t);
      if (c && c !== t) return { text: c, cut: true };
    }
    return { text: t, cut: false };
  }

  // 產生一次完整回覆（可能是 1 張，也可能連發 2~3 張）
  function planReply() {
    var n = (Math.random() * 100 < cfg.multiProb) ? (2 + Math.floor(Math.random() * 2)) : 1;
    var out = [];
    var seen = {};
    for (var i = 0; i < n * 4 && out.length < n; i++) {
      var d = drawOne();
      if (!d) break;
      if (seen[d.text]) continue;   // 同一次回覆不重複同一張
      seen[d.text] = 1;
      out.push(d);
    }
    return out;
  }

  /* ========================================================================
   * 狀態
   * ======================================================================*/
  var view = 'list';       // list | chat | cards | settings
  var activeCharId = null;
  var activeGroup = null;
  var replying = false;

  /* ========================================================================
   * 樣式（全部 cc- 前綴，避免和宿主的 !important 打架）
   * ======================================================================*/
  var CSS = `
#${SCREEN_ID} { background: var(--secondary-bg, #fff); color: var(--text-primary, #1f1f1f); }
#${SCREEN_ID} .cc-body { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
#${SCREEN_ID} .cc-pad { padding: 14px; }

.cc-row { display:flex; align-items:center; gap:12px; padding:13px 14px;
  border-bottom:1px solid var(--border-color,#e0e0e0); cursor:pointer; }
.cc-row:active { background: rgba(0,0,0,.04); }
.cc-av { width:44px; height:44px; border-radius:50%; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; font-size:20px;
  background: var(--accent-color,#007bff); color:#fff; overflow:hidden; }
.cc-av img { width:100%; height:100%; object-fit:cover; }
.cc-row-main { flex:1; min-width:0; }
.cc-row-name { font-size:16px; font-weight:600; }
.cc-row-sub { font-size:13px; color:var(--text-secondary,#8a8a8a); margin-top:3px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cc-row-side { font-size:12px; color:var(--text-secondary,#8a8a8a); flex:0 0 auto; }

.cc-empty { text-align:center; color:var(--text-secondary,#8a8a8a);
  font-size:14px; padding:56px 30px; line-height:1.9; }

.cc-btn { border:none; border-radius:10px; padding:10px 16px; font-size:15px;
  background: var(--accent-color,#007bff); color:#fff; cursor:pointer; }
.cc-btn.ghost { background:transparent; color:var(--accent-color,#007bff);
  border:1px solid var(--border-color,#e0e0e0); }
.cc-btn.danger { background:transparent; color:#d9534f;
  border:1px solid var(--border-color,#e0e0e0); }
.cc-btn:disabled { opacity:.45; cursor:default; }
.cc-btns { display:flex; gap:9px; flex-wrap:wrap; margin-top:14px; }

.cc-msgs { padding:14px 14px 20px; }
.cc-msg { display:flex; margin-bottom:11px; }
.cc-msg.me { justify-content:flex-end; }
.cc-bub { max-width:74%; padding:9px 13px; border-radius:17px; font-size:15px;
  line-height:1.55; word-break:break-word; white-space:pre-wrap;
  background:#f0f0f0; color:var(--text-primary,#1f1f1f); }
.cc-msg.me .cc-bub { background: var(--accent-color,#007bff); color:#fff; }
.cc-bub.cut { opacity:.72; font-style:italic; }
.cc-time { text-align:center; font-size:11px; color:var(--text-secondary,#8a8a8a);
  margin:14px 0 10px; }
.cc-typing { font-size:13px; color:var(--text-secondary,#8a8a8a); padding:0 16px 12px; }

.cc-input { flex:0 0 auto; display:flex; gap:9px; align-items:flex-end;
  padding:10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top:1px solid var(--border-color,#e0e0e0);
  background: var(--secondary-bg,#fff); }
.cc-input textarea { flex:1; resize:none; border:1px solid var(--border-color,#e0e0e0);
  border-radius:18px; padding:9px 13px; font-size:15px; font-family:inherit;
  max-height:96px; line-height:1.45; background:#fafafa;
  color:var(--text-primary,#1f1f1f); }
.cc-input textarea:focus { outline:none; border-color: var(--accent-color,#007bff); }

.cc-card { border:1px solid var(--border-color,#e0e0e0); border-radius:12px;
  padding:11px 13px; margin-bottom:9px; font-size:15px; line-height:1.55;
  display:flex; gap:10px; align-items:flex-start; }
.cc-card span { flex:1; word-break:break-word; }
.cc-del { color:#d9534f; font-size:19px; line-height:1; cursor:pointer;
  flex:0 0 auto; padding:0 3px; }

.cc-sw { display:flex; justify-content:space-between; align-items:center;
  padding:13px 14px; border-bottom:1px solid var(--border-color,#e0e0e0); }
.cc-sw-label { font-size:15px; }
.cc-sw-sub { font-size:12px; color:var(--text-secondary,#8a8a8a); margin-top:3px; }
.cc-sw input[type=range] { width:150px; }
.cc-sw-val { font-size:13px; color:var(--text-secondary,#8a8a8a);
  min-width:46px; text-align:right; }

/* 匯入：真實的 file input 鋪在按鈕上，由 CSS 對齊而非 JS 量座標。
   Mochi 在 iOS 26 上「點了沒反應」就是因為用程式化 click()，這裡避開了。 */
.cc-pick { position:relative; display:inline-block; overflow:hidden; }
.cc-pick input[type=file] { position:absolute; inset:0; width:100%; height:100%;
  opacity:0; cursor:pointer; font-size:100px; }

.cc-toast { position:fixed; left:50%; bottom:calc(30px + env(safe-area-inset-bottom));
  transform:translate(-50%,16px); opacity:0; background:rgba(0,0,0,.84); color:#fff;
  padding:10px 17px; border-radius:999px; font-size:13.5px; z-index:99999;
  transition:.22s; pointer-events:none; max-width:82vw; text-align:center; }
.cc-toast.show { opacity:1; transform:translate(-50%,0); }

.cc-hd-act { font-size:14px; color:var(--accent-color,#007bff);
  cursor:pointer; padding:2px 4px; }
.cc-sec { font-size:12px; color:var(--text-secondary,#8a8a8a);
  padding:18px 14px 7px; }
`;

  /* ========================================================================
   * 畫面注入
   * ======================================================================*/
  function injectStyle() {
    if (document.getElementById('cc-style')) return;
    var st = document.createElement('style');
    st.id = 'cc-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function injectScreen() {
    if (document.getElementById(SCREEN_ID)) return;
    var host = document.getElementById('home-screen');
    if (!host || !host.parentElement) return false;
    var sc = document.createElement('div');
    sc.id = SCREEN_ID;
    sc.className = 'screen';
    sc.innerHTML =
      '<div class="header">' +
        '<span class="back-btn" id="cc-back">‹</span>' +
        '<span id="cc-title">' + APP_LABEL + '</span>' +
        '<div class="header-actions"><span class="cc-hd-act" id="cc-act"></span></div>' +
      '</div>' +
      '<div class="cc-body" id="cc-body"></div>' +
      '<div class="cc-input" id="cc-input" style="display:none">' +
        '<textarea id="cc-text" rows="1" placeholder="說點什麼"></textarea>' +
        '<button class="cc-btn" id="cc-send">送出</button>' +
      '</div>';
    host.parentElement.appendChild(sc);
    return true;
  }

  function injectIcon() {
    if (document.getElementById('cc-app-icon')) return;
    var box = document.getElementById('desktop-app-container');
    if (!box) return false;
    var el = document.createElement('div');
    el.className = 'desktop-app-icon';
    el.id = 'cc-app-icon';
    el.innerHTML =
      '<div class="icon-bg-desktop" style="display:flex;align-items:center;' +
      'justify-content:center;font-size:26px;background:#eceae4;">🗂️</div>' +
      '<span class="label">' + APP_LABEL + '</span>';
    el.addEventListener('click', open);
    box.appendChild(el);
    return true;
  }

  /* ========================================================================
   * 畫面切換
   * ======================================================================*/
  function open() {
    if (typeof window.showScreen === 'function') window.showScreen(SCREEN_ID);
    else {
      document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
      document.getElementById(SCREEN_ID).classList.add('active');
    }
    go('list');
  }

  function go(v, arg) {
    view = v;
    if (v === 'chat') activeCharId = arg || activeCharId;
    if (v === 'cards' && arg !== undefined) activeGroup = arg;
    render();
  }

  function back() {
    if (view === 'chat' || view === 'cards' || view === 'settings') {
      if (view === 'cards' && activeGroup) { activeGroup = null; return go('cards'); }
      return go('list');
    }
    if (typeof window.showScreen === 'function') window.showScreen('home-screen');
  }

  /* ========================================================================
   * 渲染
   * ======================================================================*/
  async function render() {
    var body = $('#cc-body'), title = $('#cc-title'), act = $('#cc-act');
    var inputBar = $('#cc-input');
    if (!body) return;
    inputBar.style.display = (view === 'chat') ? 'flex' : 'none';
    act.onclick = null;
    act.textContent = '';

    if (view === 'list') {
      title.textContent = APP_LABEL;
      act.textContent = '＋';
      act.onclick = addChar;
      var chars = await db.chars.orderBy('name').toArray();
      var allCards = await db.cards.toArray();
      var counts = allCards.length;
      var grpSet = {};
      allCards.forEach(function (c) { grpSet[c.grp] = 1; });
      var grpCount = Object.keys(grpSet).length;
      var html = '';
      if (!chars.length) {
        html += '<div class="cc-empty">還沒有角色。<br>點右上角的 ＋ 建立第一個。</div>';
      } else {
        for (var i = 0; i < chars.length; i++) {
          var c = chars[i];
          var last = await db.msgs.where('charId').equals(c.id).reverse().sortBy('ts');
          var sub = last.length ? (last[0].who === 'me' ? '我：' : '') + last[0].text : '還沒有對話';
          html += '<div class="cc-row" data-char="' + c.id + '">' +
            '<div class="cc-av">' + (c.avatar
              ? '<img src="' + esc(c.avatar) + '">'
              : esc((c.name || '?').slice(0, 1))) + '</div>' +
            '<div class="cc-row-main">' +
              '<div class="cc-row-name">' + esc(c.name) + '</div>' +
              '<div class="cc-row-sub">' + esc(sub) + '</div>' +
            '</div>' +
            '<div class="cc-row-side">' + (last.length ? hhmm(last[0].ts) : '') + '</div>' +
          '</div>';
        }
      }
      html += '<div class="cc-sec">字卡庫</div>' +
        '<div class="cc-row" data-go="cards">' +
          '<div class="cc-av" style="background:#8e8e93">🗂</div>' +
          '<div class="cc-row-main"><div class="cc-row-name">管理字卡</div>' +
          '<div class="cc-row-sub">' + counts + ' 張，' + grpCount + ' 組</div></div>' +
          '<div class="cc-row-side">›</div>' +
        '</div>' +
        '<div class="cc-row" data-go="settings">' +
          '<div class="cc-av" style="background:#8e8e93">⚙</div>' +
          '<div class="cc-row-main"><div class="cc-row-name">回覆設定</div>' +
          '<div class="cc-row-sub">多字卡 ' + cfg.multiProb + '%　撤回式 ' + cfg.cutProb + '%</div></div>' +
          '<div class="cc-row-side">›</div>' +
        '</div>';
      body.innerHTML = html;
      body.querySelectorAll('[data-char]').forEach(function (el) {
        el.onclick = function () { go('chat', el.dataset.char); };
      });
      body.querySelector('[data-go="cards"]').onclick = function () { activeGroup = null; go('cards'); };
      body.querySelector('[data-go="settings"]').onclick = function () { go('settings'); };
      return;
    }

    if (view === 'chat') {
      var ch = await db.chars.get(activeCharId);
      if (!ch) return go('list');
      title.textContent = ch.name;
      act.textContent = '⋯';
      act.onclick = function () { charMenu(ch); };
      var msgs = await db.msgs.where('charId').equals(activeCharId).sortBy('ts');
      var h = '<div class="cc-msgs">';
      if (!msgs.length) {
        h += '<div class="cc-empty">還沒有對話。<br>送一句話，或直接點送出看看會抽到什麼。</div>';
      }
      var lastDay = '';
      msgs.forEach(function (m) {
        var day = new Date(m.ts).toLocaleDateString();
        if (day !== lastDay) { h += '<div class="cc-time">' + day + '</div>'; lastDay = day; }
        h += '<div class="cc-msg ' + (m.who === 'me' ? 'me' : 'ta') + '">' +
          '<div class="cc-bub' + (m.cut ? ' cut' : '') + '">' + esc(m.text) + '</div></div>';
      });
      h += '</div><div class="cc-typing" id="cc-typing" style="display:none">對方正在輸入…</div>';
      body.innerHTML = h;
      body.scrollTop = body.scrollHeight;
      return;
    }

    if (view === 'cards') {
      if (!activeGroup) {
        title.textContent = '字卡庫';
        act.textContent = '＋組';
        act.onclick = addGroup;
        var all = await db.cards.toArray();
        var byGrp = {};
        all.forEach(function (c) { byGrp[c.grp] = (byGrp[c.grp] || 0) + 1; });
        var names = Object.keys(byGrp).sort();
        var g = '';
        if (!names.length) g = '<div class="cc-empty">字卡庫是空的。</div>';
        names.forEach(function (n) {
          var off = cfg.offGroups.indexOf(n) !== -1;
          g += '<div class="cc-row" data-grp="' + esc(n) + '">' +
            '<div class="cc-row-main"><div class="cc-row-name">' + esc(n) +
              (off ? '　<span style="font-size:12px;color:#d9534f">已關閉</span>' : '') + '</div>' +
            '<div class="cc-row-sub">' + byGrp[n] + ' 張</div></div>' +
            '<div class="cc-row-side">›</div></div>';
        });
        g += '<div class="cc-pad"><div class="cc-btns">' +
          '<span class="cc-pick"><button class="cc-btn ghost">匯入 JSON</button>' +
          '<input type="file" id="cc-imp" accept="application/json,.json"></span>' +
          '<button class="cc-btn ghost" id="cc-exp">匯出 JSON</button>' +
          '</div><div class="cc-row-sub" style="margin-top:10px">' +
          '匯出的檔案包含角色、字卡與對話，可用來備份或換裝置。</div></div>';
        body.innerHTML = g;
        body.querySelectorAll('[data-grp]').forEach(function (el) {
          el.onclick = function () { go('cards', el.dataset.grp); };
        });
        $('#cc-exp').onclick = doExport;
        $('#cc-imp').onchange = doImport;
        return;
      }
      title.textContent = activeGroup;
      act.textContent = '＋卡';
      act.onclick = addCard;
      var rows = await db.cards.where('grp').equals(activeGroup).toArray();
      var offNow = cfg.offGroups.indexOf(activeGroup) !== -1;
      var c2 = '<div class="cc-sw"><div><div class="cc-sw-label">加入抽卡池</div>' +
        '<div class="cc-sw-sub">關閉後這組不會被角色抽到</div></div>' +
        '<input type="checkbox" id="cc-grp-on"' + (offNow ? '' : ' checked') + '></div>' +
        '<div class="cc-pad">';
      rows.forEach(function (r) {
        c2 += '<div class="cc-card"><span>' + esc(r.text) + '</span>' +
          '<span class="cc-del" data-del="' + r.id + '">×</span></div>';
      });
      if (!rows.length) c2 += '<div class="cc-empty">這組還沒有字卡。</div>';
      c2 += '<div class="cc-btns"><button class="cc-btn danger" id="cc-delgrp">刪除整組</button></div></div>';
      body.innerHTML = c2;
      $('#cc-grp-on').onchange = async function (e) {
        var i = cfg.offGroups.indexOf(activeGroup);
        if (e.target.checked) { if (i !== -1) cfg.offGroups.splice(i, 1); }
        else if (i === -1) cfg.offGroups.push(activeGroup);
        await saveCfg(); await rebuildPool();
        toast(e.target.checked ? '已加入抽卡池' : '已移出抽卡池');
      };
      body.querySelectorAll('[data-del]').forEach(function (el) {
        el.onclick = async function () {
          await db.cards.delete(Number(el.dataset.del));
          await rebuildPool(); render();
        };
      });
      $('#cc-delgrp').onclick = async function () {
        if (!confirm('刪除「' + activeGroup + '」整組共 ' + rows.length + ' 張字卡？')) return;
        await db.cards.where('grp').equals(activeGroup).delete();
        await rebuildPool();
        activeGroup = null; render();
        toast('已刪除');
      };
      return;
    }

    if (view === 'settings') {
      title.textContent = '回覆設定';
      body.innerHTML =
        slider('multiProb', '多字卡回覆', '一次連發 2~3 張的機率', 0, 100, '%') +
        slider('cutProb', '撤回式截斷', '句子說到一半停住的機率，截斷的句子不會存回字卡庫', 0, 60, '%') +
        slider('delayMin', '最短延遲', '角色開始回覆前等待的下限', 0, 4000, 'ms') +
        slider('delayMax', '最長延遲', '角色開始回覆前等待的上限', 0, 8000, 'ms') +
        '<div class="cc-pad"><div class="cc-row-sub">目前抽卡池：' + pool.length + ' 張</div>' +
        '<div class="cc-btns"><button class="cc-btn danger" id="cc-reset">清空全部資料</button></div></div>';
      body.querySelectorAll('input[type=range]').forEach(function (el) {
        el.oninput = function () {
          $('#cc-val-' + el.dataset.k).textContent = el.value + (el.dataset.unit || '');
        };
        el.onchange = async function () {
          cfg[el.dataset.k] = Number(el.value);
          if (cfg.delayMax < cfg.delayMin) cfg.delayMax = cfg.delayMin;
          await saveCfg();
        };
      });
      $('#cc-reset').onclick = async function () {
        if (!confirm('這會刪掉所有角色、字卡與對話，且無法復原。確定嗎？')) return;
        await db.delete();
        toast('已清空，正在重載');
        setTimeout(function () { location.reload(); }, 900);
      };
      return;
    }
  }

  function slider(k, label, sub, min, max, unit) {
    return '<div class="cc-sw"><div style="flex:1"><div class="cc-sw-label">' + label + '</div>' +
      '<div class="cc-sw-sub">' + sub + '</div></div>' +
      '<input type="range" min="' + min + '" max="' + max + '" value="' + cfg[k] +
      '" data-k="' + k + '" data-unit="' + unit + '">' +
      '<div class="cc-sw-val" id="cc-val-' + k + '">' + cfg[k] + unit + '</div></div>';
  }

  /* ========================================================================
   * 動作
   * ======================================================================*/
  async function addChar() {
    var name = prompt('角色名稱');
    if (!name || !name.trim()) return;
    await db.chars.add({ id: uid('c'), name: name.trim(), avatar: '', createdAt: Date.now() });
    render();
  }

  async function charMenu(ch) {
    var a = prompt('輸入 1 改名，輸入 2 清空這個角色的對話，輸入 3 刪除角色', '');
    if (a === '1') {
      var n = prompt('新的名稱', ch.name);
      if (n && n.trim()) { await db.chars.update(ch.id, { name: n.trim() }); render(); }
    } else if (a === '2') {
      if (confirm('清空與 ' + ch.name + ' 的所有對話？')) {
        await db.msgs.where('charId').equals(ch.id).delete();
        render(); toast('已清空');
      }
    } else if (a === '3') {
      if (confirm('刪除角色 ' + ch.name + ' 和所有對話？')) {
        await db.msgs.where('charId').equals(ch.id).delete();
        await db.chars.delete(ch.id);
        go('list'); toast('已刪除');
      }
    }
  }

  async function addGroup() {
    var n = prompt('新分組名稱');
    if (!n || !n.trim()) return;
    var t = prompt('先放一張字卡進去');
    if (!t || !t.trim()) return;
    await db.cards.add({ grp: n.trim(), text: t.trim() });
    await rebuildPool(); render();
  }

  async function addCard() {
    var t = prompt('新字卡內容（多張請用換行分隔）');
    if (!t || !t.trim()) return;
    var lines = t.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    await db.cards.bulkAdd(lines.map(function (s) { return { grp: activeGroup, text: s }; }));
    await rebuildPool(); render();
    toast('加了 ' + lines.length + ' 張');
  }

  async function send() {
    if (replying) return;
    var ta = $('#cc-text');
    var txt = (ta.value || '').trim();
    var now = Date.now();
    if (txt) {
      await db.msgs.add({ charId: activeCharId, who: 'me', text: txt, ts: now });
      ta.value = ''; ta.style.height = 'auto';
      await render();
    }
    if (!pool.length) { toast('抽卡池是空的，先去字卡庫加幾張'); return; }

    replying = true;
    var body = $('#cc-body');
    var typing = $('#cc-typing');
    if (typing) { typing.style.display = 'block'; body.scrollTop = body.scrollHeight; }

    var plan = planReply();
    for (var i = 0; i < plan.length; i++) {
      var wait = cfg.delayMin + Math.random() * Math.max(0, cfg.delayMax - cfg.delayMin);
      await sleep(i === 0 ? wait : 400 + Math.random() * 700);
      await db.msgs.add({
        charId: activeCharId, who: 'ta',
        text: plan[i].text, cut: plan[i].cut ? 1 : 0, ts: Date.now()
      });
      await render();
    }
    replying = false;
  }

  /* ---- 匯出 / 匯入 ------------------------------------------------------
   * 匯入用的是真實 <input type="file">，由 CSS 鋪在按鈕上（見 .cc-pick）。
   * 不用程式化 click()、不量座標，所以不會有 iOS 上「點了沒反應」的問題。
   * -------------------------------------------------------------------- */
  async function doExport() {
    try {
      var data = {
        format: 'cardchat-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        cfg: cfg,
        chars: await db.chars.toArray(),
        cards: await db.cards.toArray(),
        msgs: await db.msgs.toArray()
      };
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cardchat-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('已匯出 ' + data.cards.length + ' 張字卡');
    } catch (e) {
      alert('匯出失敗：' + (e && e.message));
    }
  }

  async function doImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';              // 讓同一個檔案可以再選一次
    if (!f) { toast('沒有取到檔案'); return; }
    var text;
    try {
      text = await f.text();
    } catch (e) {
      alert('讀不到這個檔案，如果是從雲端硬碟選的，先把它下載到本機再試一次。');
      return;
    }
    var data;
    try { data = JSON.parse(text); } catch (e) { alert('這不是有效的 JSON 檔。'); return; }
    if (!data || data.format !== 'cardchat-backup') {
      if (!confirm('這份檔案不是本 App 匯出的備份，仍要嘗試匯入嗎？')) return;
    }
    var mode = confirm('按「確定」＝合併（保留現有資料）\n按「取消」＝覆蓋（清掉現有資料）');
    try {
      await db.transaction('rw', db.chars, db.cards, db.msgs, db.meta, async function () {
        if (!mode) {
          await db.chars.clear(); await db.cards.clear(); await db.msgs.clear();
        }
        if (Array.isArray(data.chars)) await db.chars.bulkPut(data.chars);
        if (Array.isArray(data.cards)) {
          var rows = data.cards.map(function (c) { return { grp: c.grp, text: c.text }; });
          await db.cards.bulkAdd(rows);
        }
        if (Array.isArray(data.msgs)) {
          await db.msgs.bulkAdd(data.msgs.map(function (m) {
            return { charId: m.charId, who: m.who, text: m.text, cut: m.cut || 0, ts: m.ts };
          }));
        }
        if (data.cfg) { cfg = Object.assign({}, DEFAULT_CFG, data.cfg); await saveCfg(); }
      });
      await rebuildPool();
      render();
      toast('匯入完成');
    } catch (e) {
      alert('匯入失敗，原有資料已保留：' + (e && e.message));
    }
  }

  /* ========================================================================
   * 啟動
   * ======================================================================*/
  function bind() {
    $('#cc-back').onclick = back;
    $('#cc-send').onclick = send;
    var ta = $('#cc-text');
    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(96, ta.scrollHeight) + 'px';
    });
  }

  async function boot() {
    try {
      injectStyle();
      if (!injectScreen()) { console.warn('[cardchat] 找不到 #home-screen，畫面沒有掛上'); return; }
      injectIcon();
      bind();
      await openDB();
      await loadCfg();
      await seedIfEmpty();
      await rebuildPool();
      window.CardChat = { open: open, db: db };   // 方便從 Console 手動開啟
      console.log('[cardchat] 就緒，抽卡池 ' + pool.length + ' 張。輸入 CardChat.open() 可直接開啟。');
    } catch (e) {
      console.error('[cardchat] 啟動失敗', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
