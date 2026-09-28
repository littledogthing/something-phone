/* EPhone v4: calendar + sync cards + SillyTavern compatibility */
(()=>{
  'use strict';
  const KEY='ephone_modern_core_v5';
  const now=()=>Date.now();
  const today=()=>{const d=new Date();return dateKey(d)};
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const deep=o=>JSON.parse(JSON.stringify(o));
  const uid=p=>p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  const dateKey=d=>{d=d||new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const timeKey=()=>{const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`};
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
  let core=Object.assign({version:5,calendar:{events:[],viewDate:null,selectedDate:null,editingId:null},sync:{global:[],byCharacter:{}},settings:{scanDepth:8,budgetEntries:30}},load());
  core.calendar=Object.assign({events:[],viewDate:null,selectedDate:null,editingId:null,memorialEditingId:null},core.calendar||{});
  core.calendar.events=Array.isArray(core.calendar.events)?core.calendar.events:[];
  core.calendar.memorialDays=Array.isArray(core.calendar.memorialDays)?core.calendar.memorialDays:[];
  core.sync=Object.assign({global:[],byCharacter:{}},core.sync||{});
  core.sync.global=Array.isArray(core.sync.global)?core.sync.global:[];
  core.sync.byCharacter=core.sync.byCharacter&&typeof core.sync.byCharacter==='object'?core.sync.byCharacter:{};

  function persist(){try{localStorage.setItem(KEY,JSON.stringify(core))}catch(e){console.warn('[EPhone] save failed',e)}}
  function chars(){return window.state?.chats?Object.values(window.state.chats).filter(c=>c&&!c.isGroup):[]}
  function charName(id){return chars().find(c=>c.id===id)?.name||'角色'}
  function ensureCurrentCalendarView(){
    const minMonth=`${today().slice(0,7)}-01`;
    let v=core.calendar.viewDate;
    if(!v || String(v).slice(0,7)+'-01'<minMonth) v=minMonth;
    const d=new Date(v+'T12:00:00');
    if(Number.isNaN(d.getTime())) return minMonth;
    if(dateKey(d).slice(0,7)+'-01'<minMonth) return minMonth;
    return dateKey(new Date(d.getFullYear(),d.getMonth(),1));
  }
  function isFutureEvent(e){
    if(!e?.date || e.date<today()) return false;
    if(e.date>today()) return true;
    if(!e.start) return true;
    return e.start>=timeKey();
  }

  function memorialNextDate(m, baseDate=new Date()){
    if(!m?.date) return null;
    const src=new Date(String(m.date)+'T12:00:00');
    if(Number.isNaN(src.getTime())) return null;
    if(!m.annual) return dateKey(src);
    const y=baseDate.getFullYear();
    let d=new Date(y,src.getMonth(),src.getDate(),12);
    // 2/29 anniversaries use 2/28 in non-leap years, because calendars enjoy edge cases.
    if(src.getMonth()===1 && src.getDate()===29 && d.getMonth()!==1) d=new Date(y,1,28,12);
    if(dateKey(d)<dateKey(baseDate)){
      d=new Date(y+1,src.getMonth(),src.getDate(),12);
      if(src.getMonth()===1 && src.getDate()===29 && d.getMonth()!==1) d=new Date(y+1,1,28,12);
    }
    return dateKey(d);
  }
  function daysBetween(a,b){
    const x=new Date(String(a)+'T12:00:00'),y=new Date(String(b)+'T12:00:00');
    return Math.round((y-x)/86400000);
  }
  function memorialInfo(m){
    const original=String(m.date||'');
    const next=memorialNextDate(m);
    const until=next?daysBetween(today(),next):null;
    const years=original?Math.max(0,new Date(today()+'T12:00:00').getFullYear()-new Date(original+'T12:00:00').getFullYear()):0;
    return {next,until,years};
  }
  function memorialContext(charId){
    const list=core.calendar.memorialDays.filter(m=>m.shared!==false&&(!m.characterId||m.characterId===charId)).map(m=>({m,info:memorialInfo(m)})).filter(x=>x.info.next).sort((a,b)=>a.info.until-b.info.until).slice(0,12);
    if(!list.length)return '\n# EPhone 紀念日\n目前沒有已設定的紀念日。';
    return '\n# EPhone 紀念日\n'+list.map(({m,info})=>`- ${m.date}${m.annual?'（每年）':''}｜${m.type||'其他'}｜${m.title}｜距離下次 ${info.until} 天｜下次 ${info.next}${m.description?`｜${m.description}`:''}`).join('\n');
  }
  function addMemorialDay(data={}){
    const m={id:uid('mem'),title:String(data.title||'').trim(),date:String(data.date||'').trim(),type:String(data.type||'其他').trim()||'其他',annual:data.annual!==false,description:String(data.description||'').trim(),shared:data.shared!==false,ownerType:data.ownerType||'user',characterId:String(data.characterId||''),ownerName:data.ownerName||'你',createdAt:now(),updatedAt:now()};
    if(!m.title||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error('紀念日需要名稱與 YYYY-MM-DD 日期。');
    core.calendar.memorialDays.push(m);persist();return m;
  }
  function updateMemorialDay(id,data={}){const i=core.calendar.memorialDays.findIndex(x=>x.id===id);if(i<0)throw new Error('找不到這個紀念日。');core.calendar.memorialDays[i]=Object.assign({},core.calendar.memorialDays[i],data, {updatedAt:now()});persist();return core.calendar.memorialDays[i]}
  function removeMemorialDay(id){core.calendar.memorialDays=core.calendar.memorialDays.filter(x=>x.id!==id);persist()}

  function splitKeys(v){if(Array.isArray(v))return v.map(x=>String(x).trim()).filter(Boolean);return String(v||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)}
  const ST_POSITIONS={
    0:'before_char',1:'after_char',2:'ANTop',3:'ANBottom',4:'atDepth',5:'EMTop',6:'EMBottom',7:'outlet'
  };
  const ST_POSITION_LABELS={
    0:'角色定义前',1:'角色定义后',2:'作者注释顶部',3:'作者注释底部',4:'@ D（深度）',5:'示例消息前',6:'示例消息后',7:'Outlet（输出口）'
  };
  function positionNumber(v){
    if(typeof v==='number' && Number.isFinite(v)) return Math.max(0,Math.min(7,Math.trunc(v)));
    const map={before_char:0,after_char:1,ANTop:2,ANBottom:3,atDepth:4,EMTop:5,EMBottom:6,outlet:7,before:0,after:1};
    return Object.prototype.hasOwnProperty.call(map,String(v))?map[String(v)]:0;
  }
  function normalizeNativeSTEntry(e,i){
    e=e||{};
    const base=deep(e);
    base.uid=Number.isFinite(Number(base.uid))?Number(base.uid):i;
    base.key=splitKeys(base.key ?? base.keys ?? base.triggers);
    base.keysecondary=splitKeys(base.keysecondary ?? base.secondary_keys ?? base.secondaryKeys);
    base.comment=String(base.comment ?? base.name ?? `Entry ${i+1}`);
    base.content=String(base.content ?? '');
    base.constant=!!base.constant;
    base.vectorized=!!base.vectorized;
    base.selective=!!base.selective;
    base.selectiveLogic=Number(base.selectiveLogic ?? 0);
    base.addMemo=base.addMemo==null?true:!!base.addMemo;
    base.order=Number(base.order ?? base.insertion_order ?? 100);
    base.position=positionNumber(base.position);
    base.disable=base.disable!=null?!!base.disable:base.enabled===false;
    base.ignoreBudget=!!base.ignoreBudget;
    base.excludeRecursion=!!base.excludeRecursion;
    base.preventRecursion=!!base.preventRecursion;
    base.delayUntilRecursion=base.delayUntilRecursion ?? false;
    base.probability=Number(base.probability ?? base.priority ?? 100);
    base.useProbability=base.useProbability==null?true:!!base.useProbability;
    base.depth=Number(base.depth ?? 4);
    base.outletName=String(base.outletName ?? '');
    base.group=String(base.group ?? '');
    base.groupOverride=!!base.groupOverride;
    base.groupWeight=Number(base.groupWeight ?? 100);
    base.scanDepth=base.scanDepth==null?null:Number(base.scanDepth);
    base.caseSensitive=base.caseSensitive==null?null:!!base.caseSensitive;
    base.matchWholeWords=base.matchWholeWords==null?null:!!base.matchWholeWords;
    base.useGroupScoring=base.useGroupScoring==null?null:!!base.useGroupScoring;
    base.automationId=String(base.automationId ?? '');
    base.role=base.role==null?0:Number(base.role);
    base.sticky=base.sticky ?? null;
    base.cooldown=base.cooldown ?? null;
    base.delay=base.delay ?? null;
    base.triggers=Array.isArray(base.triggers)?base.triggers:[];
    base.useRegex=!!base.useRegex;
    base.characterFilter=base.characterFilter&&typeof base.characterFilter==='object'
      ? deep(base.characterFilter)
      : {isExclude:false,names:Array.isArray(base.characterFilterNames)?base.characterFilterNames:[],tags:Array.isArray(base.characterFilterTags)?base.characterFilterTags:[]};
    base.extensions=base.extensions&&typeof base.extensions==='object'?deep(base.extensions):{};
    delete base.keys; delete base.secondary_keys; delete base.secondaryKeys; delete base.enabled;
    return base;
  }

  function characterBookFor(id){
    const c=chars().find(x=>x.id===id);
    const raw=c?.settings?.stCharacterData || c?.stCharacterData;
    const rawBook=raw?.data?.character_book || raw?.character_book;
    if(rawBook?.entries){
      const arr=Array.isArray(rawBook.entries)?rawBook.entries:Object.values(rawBook.entries);
      return Object.assign({},deep(rawBook),{entries:arr.map((e,i)=>normalizeV2BookEntry(e,i))});
    }
    const books=(window.state?.worldBooks||[]).filter(b=>b&&b.categoryId&&b.categoryId===c?.settings?.stWorldBookCategoryId);
    if(!books.length)return undefined;
    return {
      name:`${charName(id)} · Character Book`,
      description:'EPhone character-linked lorebook',
      scan_depth:100,
      token_budget:2048,
      recursive_scanning:true,
      extensions:{ephone:{scopeType:'character',characterId:id}},
      entries:books.map((b,i)=>nativeToV2Entry(b.stData||b,i))
    };
  }
  function normalizeV2BookEntry(e,i){
    const src=deep(e||{});
    const st=src.extensions?.ephone?.st || src.extensions?.sillytavern || {};
    const position=src.position ?? st.position ?? 'before_char';
    const out={
      keys:splitKeys(src.keys ?? src.key),
      content:String(src.content??''),
      extensions:src.extensions&&typeof src.extensions==='object'?deep(src.extensions):{},
      enabled:src.enabled ?? !(src.disable===true),
      insertion_order:Number(src.insertion_order ?? src.order ?? 100),
      case_sensitive:src.case_sensitive==null?(src.caseSensitive==null?undefined:!!src.caseSensitive):!!src.case_sensitive,
      name:src.name ?? src.comment ?? `Entry ${i+1}`,
      priority:src.priority==null?(src.probability==null?undefined:Number(src.probability)):Number(src.priority),
      id:src.id==null?(src.uid==null?i:Number(src.uid)):src.id,
      comment:src.comment ?? src.name ?? `Entry ${i+1}`,
      selective:!!src.selective,
      secondary_keys:splitKeys(src.secondary_keys ?? src.keysecondary ?? src.secondaryKeys),
      constant:!!src.constant,
      position:typeof position==='number'?(position===0?'before_char':'after_char'):(position==='after_char'?'after_char':'before_char')
    };
    const stMeta={
      position:positionNumber(position), depth:Number(src.depth ?? st.depth ?? 4), role:src.role==null?(st.role==null?0:Number(st.role)):Number(src.role),
      scanDepth:src.scanDepth==null?(st.scanDepth==null?null:Number(st.scanDepth)):Number(src.scanDepth),
      probability:Number(src.probability ?? st.probability ?? 100), useProbability:src.useProbability==null?(st.useProbability==null?true:!!st.useProbability):!!src.useProbability,
      matchWholeWords:src.matchWholeWords==null?(st.matchWholeWords==null?null:!!st.matchWholeWords):!!src.matchWholeWords,
      selectiveLogic:Number(src.selectiveLogic ?? st.selectiveLogic ?? 0), group:String(src.group ?? st.group ?? ''), groupOverride:!!(src.groupOverride ?? st.groupOverride),
      groupWeight:Number(src.groupWeight ?? st.groupWeight ?? 100), useGroupScoring:src.useGroupScoring==null?(st.useGroupScoring==null?null:!!st.useGroupScoring):!!src.useGroupScoring,
      excludeRecursion:!!(src.excludeRecursion ?? st.excludeRecursion), preventRecursion:!!(src.preventRecursion ?? st.preventRecursion), delayUntilRecursion:!!(src.delayUntilRecursion ?? st.delayUntilRecursion),
      outletName:String(src.outletName ?? st.outletName ?? ''), automationId:String(src.automationId ?? st.automationId ?? ''), useRegex:!!(src.use_regex ?? src.useRegex ?? st.useRegex),
      vectorized:!!(src.vectorized ?? st.vectorized), ignoreBudget:!!(src.ignoreBudget ?? st.ignoreBudget), addMemo:src.addMemo==null?true:!!src.addMemo,
      characterFilter:src.characterFilter&&typeof src.characterFilter==='object'?deep(src.characterFilter):{isExclude:false,names:Array.isArray(src.characterFilterNames)?src.characterFilterNames:[],tags:Array.isArray(src.characterFilterTags)?src.characterFilterTags:[]},
      triggers:Array.isArray(src.triggers)?deep(src.triggers):[],
      sticky:src.sticky??null,cooldown:src.cooldown??null,delay:src.delay??null
    };
    out.extensions=Object.assign({},out.extensions,{ephone:Object.assign({},out.extensions.ephone||{},{st:stMeta})});
    if(out.case_sensitive===undefined) delete out.case_sensitive;
    if(out.priority===undefined) delete out.priority;
    return out;
  }

  function nativeToV2Entry(e,i){
    const src=normalizeNativeSTEntry(e,i);
    return normalizeV2BookEntry(src,i);
  }
  function characterToV2(c){
    c=c||{};
    const raw=deep(c.settings?.stCharacterData || c.stCharacterData || {});
    const d=raw.data || raw || {};
    const out={
      name:c.name||d.name||'',
      description:d.description??c.settings?.aiPersona??c.description??'',
      personality:d.personality??c.personality??'',
      scenario:d.scenario??c.scenario??'',
      first_mes:d.first_mes??d.firstMes??c.first_mes??c.firstMes??'',
      mes_example:d.mes_example??d.mesExample??c.mes_example??c.mesExample??'',
      creator_notes:d.creator_notes??c.creator_notes??'',
      system_prompt:d.system_prompt??c.system_prompt??'',
      post_history_instructions:d.post_history_instructions??c.post_history_instructions??'',
      alternate_greetings:Array.isArray(d.alternate_greetings)?deep(d.alternate_greetings):(Array.isArray(c.alternate_greetings)?deep(c.alternate_greetings):[]),
      tags:Array.isArray(d.tags)?deep(d.tags):(Array.isArray(c.tags)?deep(c.tags):[]),
      creator:d.creator??c.creator??'',
      character_version:d.character_version??c.character_version??'1.0',
      extensions:deep(Object.assign({},d.extensions||{},c.extensions||{}, {ephone:Object.assign({},d.extensions?.ephone||{}, {characterId:c.id||'',exportedAt:now()})}))
    };
    const book=d.character_book||characterBookFor(c.id);
    if(book)out.character_book=Object.assign({},deep(book),{extensions:deep(Object.assign({},book.extensions||{})),entries:(Array.isArray(book.entries)?book.entries:Object.values(book.entries||{})).map((e,i)=>normalizeV2BookEntry(e,i))});
    return {spec:'chara_card_v2',spec_version:'2.0',data:out};
  }

  function normalizeImportedWorld(data,name){
    if(data?.spec==='lorebook_v3' && data?.data?.entries) data=data.data;
    const book=data?.data?.character_book || data?.character_book;
    let entries=book?.entries ?? data?.entries ?? data?.world?.entries;
    if(Array.isArray(entries)) entries=Object.fromEntries(entries.map((e,i)=>[String(i),e]));
    if(!entries || typeof entries!=='object') throw new Error('找不到 SillyTavern entries');
    const topExt=(data?.extensions&&typeof data.extensions==='object')?data.extensions:{};
    const ephone=topExt.ephone||book?.extensions?.ephone||{};
    const bookName=book?.name||data?.name||name||'Imported World Info';
    return {name:bookName,topExt:deep(topExt),entries:Object.values(entries).map((e,i)=>{
      const n=normalizeNativeSTEntry(e,i);
      n.extensions=Object.assign({},n.extensions,{ephone:Object.assign({},n.extensions?.ephone||{}, {scopeType:ephone.scopeType||n.extensions?.ephone?.scopeType||'global',characterId:ephone.characterId||n.extensions?.ephone?.characterId||'',chatId:ephone.chatId||n.extensions?.ephone?.chatId||''})});
      return n;
    })};
  }

  async function importWorldObject(data,name){
    const parsed=normalizeImportedWorld(data,name);
    const categoryId=await window.db?.worldBookCategories?.add?.({name:parsed.name});
    const added=parsed.entries.map((e,i)=>({
      id:uid('wb'), uid:e.uid??i, name:e.comment||`Entry ${i+1}`, content:e.content||'', categoryId:categoryId||null,
      enabled:!e.disable, constant:!!e.constant, order:e.order, position:e.position, role:e.role,
      keys:e.key.join(', '), secondaryKeys:e.keysecondary.join(', '),
      scopeType:e.extensions?.ephone?.scopeType||'global', sourceCharacterId:e.extensions?.ephone?.characterId||'', sourceChatId:e.extensions?.ephone?.chatId||'',
      stData:deep(e)
    }));
    if(window.db?.worldBooks?.bulkPut) await window.db.worldBooks.bulkPut(added);
    if(window.state && window.db?.worldBooks){window.state.worldBooks=await window.db.worldBooks.toArray();}
    if(typeof window.renderWorldBookScreen==='function') await window.renderWorldBookScreen();
    return added.length;
  }

  function worldExport(name){
    const books=Array.isArray(window.state?.worldBooks)?window.state.worldBooks:[];
    const entries={};
    const first=books[0]||{};
    const meta=first.stBookMeta||{};
    const topExt=deep(meta.extensions||{});
    topExt.ephone=Object.assign({},topExt.ephone||{},{version:5,exportedAt:now()});
    books.forEach((b,i)=>{
      const st=normalizeNativeSTEntry(b.stData||b,i);
      const scope={scopeType:b.scopeType||st.extensions?.ephone?.scopeType||'global',characterId:b.sourceCharacterId||st.extensions?.ephone?.characterId||'',chatId:b.sourceChatId||st.extensions?.ephone?.chatId||''};
      st.extensions=Object.assign({},st.extensions,{ephone:Object.assign({},st.extensions?.ephone||{},scope)});
      entries[String(st.uid??i)]=st;
    });
    return {
      name:name||meta.name||'EPhone World Info',
      description:meta.description||'',
      scan_depth:Number(meta.scan_depth??100),
      token_budget:Number(meta.token_budget??2048),
      recursive_scanning:meta.recursive_scanning!==false,
      entries,
      extensions:topExt
    };
  }

  function v2WorldExportForCharacter(id){
    const c=chars().find(x=>x.id===id);
    return characterBookFor(c?.id||id);
  }
  function download(name,obj,type='application/json'){const blob=new Blob([typeof obj==='string'?obj:JSON.stringify(obj,null,2)],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function characterExport(id){const c=chars().find(x=>x.id===id);if(!c)throw new Error('找不到角色');download(`${c.name||'character'}_chara_card_v2.json`,characterToV2(c))}

  function calendarContext(charId){
    const events=core.calendar.events.filter(e=>isFutureEvent(e)&&e.shared!==false&&(!e.characterId||e.characterId===charId)).sort((a,b)=>(a.date+(a.start||'')).localeCompare(b.date+(b.start||''))).slice(0,12);
    const head=`\n# EPhone 共同行事曆\n- 現在時間：${new Date().toLocaleString('zh-TW',{hour12:false})}`;
    return events.length?head+'\n'+events.map(e=>`- ${e.date}${e.start?' '+e.start:''}${e.end?'–'+e.end:''}｜${e.title}${e.ownerName?`｜${e.ownerName}`:''}${e.description?`｜${e.description}`:''}`).join('\n'):head+'\n近期沒有公開行程。';
  }
  function syncContext(charId){const a=[...core.sync.global,...(core.sync.byCharacter[charId]||[])];return a.length?'\n# EPhone 同頻\n'+a.map(x=>`- ${x.kind||'狀態'}：${x.text}`).join('\n'):''}
  function independentCoreContext(){try{const raw=localStorage.getItem('EPhoneCore.v2')||localStorage.getItem('EPhoneCore.v1');if(!raw)return '';const d=JSON.parse(raw);const people=Array.isArray(d.people)?d.people:[];const snap=d.snapshot&&typeof d.snapshot==='object'?d.snapshot:null;const lines=people.map(p=>{const s=snap?.people?.[p.id];const a=p.birthday?(()=>{const b=new Date(p.birthday+'T00:00:00'),n=new Date();let age=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))age--;return age})():null;const w=s?.weather;return `- ${p.type==='user'?'User':'角色'}「${p.name||'未命名'}」：生日 ${p.birthday||'未設定'}，目前年齡 ${a==null?'未設定':a+'歲'}，位置 ${p.location||'未設定'}${w?`，目前天氣 ${w.current?.temperature_2m??'?'}°C、${w.current?.weather_code??'?'}，地點 ${w.name||''}，時區 ${w.timezone||''}`:''}`;});const rel=(snap?.relations||[]).map(r=>{const p=people.find(x=>x.id===r.personId);return `- User 與「${p?.name||r.personId}」：${r.label||'關係未判定'}${r.distance!=null?`，約 ${r.distance} km`:''}${r.timeDiff?`，時差 ${r.timeDiff>0?'+':''}${r.timeDiff} 小時`:''}`});if(!lines.length)return '';return `\n# EPhone 雙人／多人狀態\n以下資料來自 EPhone Core 的使用者設定與已同步資料。只能使用這些資料，不要自行捏造位置、生日、天氣或距離。\n${lines.join('\n')}\n${rel.join('\n')}\n這些資訊可用來理解人物目前的年齡、所在地、天氣、時差與異地／異國狀態。`;}catch{return ''}}
function chatContext(chat){const id=chat?.characterId||chat?.id||chat?.settings?.characterId||'';return calendarContext(id)+memorialContext(id)+syncContext(id)+independentCoreContext()}

  function toast(title,text){
    const root=document.getElementById('ephone-literary-tools'); if(!root)return;
    root.querySelector('.ep-toast-title').textContent=title;root.querySelector('.ep-toast-text').textContent=text;root.querySelector('.ep-toast').classList.add('show');
    clearTimeout(root._toastTimer);root._toastTimer=setTimeout(()=>root.querySelector('.ep-toast')?.classList.remove('show'),2200);
  }
  function showDialog(kind,options={}){
    const root=document.getElementById('ephone-literary-tools'); if(!root)return Promise.resolve(null);
    const modal=root.querySelector('.ep-dialog-modal'); const title=modal.querySelector('.ep-dialog-title');const body=modal.querySelector('.ep-dialog-body');const cancel=modal.querySelector('[data-ep-dialog-cancel]');const ok=modal.querySelector('[data-ep-dialog-ok]');
    title.textContent=options.title||'';body.innerHTML=options.html||'';ok.textContent=options.okText||'保存';cancel.textContent=options.cancelText||'取消';
    modal.classList.add('open');
    return new Promise(resolve=>{
      const done=v=>{modal.classList.remove('open');modal._resolver=null;resolve(v)};modal._resolver=done;
      cancel.onclick=()=>done(null);ok.onclick=()=>{try{done(options.collect?options.collect(body):true)}catch(e){toast('輸入有誤',e.message)}};
      setTimeout(()=>body.querySelector('input,textarea,select')?.focus(),80);
    });
  }
  function close(){document.getElementById('ephone-literary-tools')?.querySelector('.ep-modal')?.classList.remove('open')}
  function open(){const root=document.getElementById('ephone-literary-tools');if(!root)return;root.querySelector('.ep-modal')?.classList.add('open');renderPanel()}
  function openCalendar(){open();calendarView()}
  function openSync(){open();syncView()}

  function renderPanel(){
    const root=document.getElementById('ephone-literary-tools'),body=root?.querySelector('.ep-body');if(!root||!body)return;
    const c=chars();
    body.innerHTML=`<div class="ep-sub">角色、世界、時間與同頻集中管理。資料匯出以 SillyTavern 可交換格式為基準。</div>
      <div class="ep-grid"><button class="ep-action" data-ep="calendar"><strong>共用行事曆</strong><span>只能建立今天或未來的行程</span></button><button class="ep-action" data-ep="sync"><strong>同頻</strong><span>一行一句，TXT / JSON 都可直接加入</span></button><button class="ep-action" data-ep="st-import"><strong>匯入 ST World Info</strong><span>保留原生 entry 欄位</span></button><button class="ep-action" data-ep="st-export"><strong>匯出 ST World Info</strong><span>原生 entries 物件格式</span></button></div>
      <div class="ep-section"><h3>Character Card V2</h3><select class="ep-select" id="ep-char-select"><option value="">選擇角色</option>${c.map(x=>`<option value="${esc(x.id)}">${esc(x.name||'未命名')}</option>`).join('')}</select><div class="ep-toolbar"><button data-ep="char-export">匯出 V2 JSON</button><button data-ep="char-copy">複製 V2 JSON</button></div><div class="ep-note">Character Card V2 的 character_book 會使用標準陣列 entries；未知 extensions 會一併保留。</div></div>
      <div class="ep-section"><h3>本地資料</h3><div class="ep-meta">共用行事曆 ${core.calendar.events.length} 筆 · 全域同頻 ${core.sync.global.length} 筆 · 角色同頻 ${Object.values(core.sync.byCharacter).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0)} 筆</div></div>`;
  }

  function calendarView(){
    const root=document.getElementById('ephone-literary-tools');
    const body=root.querySelector('.ep-body');
    core.calendar.viewDate=ensureCurrentCalendarView();
    const d=new Date(core.calendar.viewDate+'T12:00:00');
    const y=d.getFullYear(),m=d.getMonth();
    const minMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
    const isMinMonth=y===minMonth.getFullYear()&&m===minMonth.getMonth();
    const first=(new Date(y,m,1).getDay()+6)%7;
    const last=new Date(y,m+1,0).getDate();
    let cells='';
    for(let i=0;i<first;i++) cells+='<div class="ep-day muted"></div>';
    for(let day=1;day<=last;day++){
      const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dayPast=key<today();
      const ev=core.calendar.events.filter(e=>e.date===key&&isFutureEvent(e));
      const mini=ev.slice(0,3).map(e=>`<div class="ep-event ${e.ownerType==='character'?'char':''}">${esc(e.title)}</div>`).join('');
      cells+=`<button class="ep-day ${key===today()?'today':''} ${dayPast?'past-day':''}" data-ep-day="${key}" ${dayPast?'disabled':''}><span class="ep-day-num">${day}</span>${mini}</button>`;
    }
    const selected=core.calendar.selectedDate && core.calendar.selectedDate>=today()?core.calendar.selectedDate:today();
    const eventsForSelected=core.calendar.events.filter(e=>e.date===selected&&isFutureEvent(e)).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    const editing=core.calendar.events.find(e=>e.id===core.calendar.editingId);
    const ownerOptions=['<option value="user">我</option>'].concat(chars().map(c=>`<option value="character:${esc(c.id)}">${esc(c.name)}</option>`)).join('');
    const eventRows=eventsForSelected.map(e=>`<div class="ep-row"><div class="ep-row-main"><div class="ep-row-title">${esc(e.title)}</div><div class="ep-meta">${e.start||'全天'}${e.end?'–'+e.end:''} · ${esc(e.ownerName||'我')} · ${e.shared===false?'私密':'共同'}</div></div><button data-ep-edit="${esc(e.id)}">編輯</button></div>`).join('')||'<div class="ep-empty">這一天還沒有未來行程。</div>';
    const shareChecked=editing ? editing.shared!==false : true;
    const editingDelete=editing?'<button class="ep-danger-btn" data-ep="delete-editing">刪除</button>':'';
    const memorialRows=core.calendar.memorialDays.slice().map(m=>({m,info:memorialInfo(m)})).sort((a,b)=>(a.info.until??999999)-(b.info.until??999999)).map(({m,info})=>`<div class="ep-row"><div class="ep-row-main"><div class="ep-row-title">${esc(m.title)} <span class="ep-chip">${esc(m.type||'其他')}</span></div><div class="ep-meta">${esc(m.date)}${m.annual?' · 每年':''} · ${info.until===0?'就是今天':`距離下次 ${info.until} 天`}${info.years>0?` · 已經 ${info.years} 年`:''}${m.description?` · ${esc(m.description)}`:''}</div></div><button data-ep-mem-edit="${esc(m.id)}">編輯</button><button data-ep-mem-del="${esc(m.id)}">刪除</button></div>`).join('')||'<div class="ep-empty">還沒有紀念日。可以加入在一起紀念日、生日、初遇日或任何你想留下的日子。</div>';
    const h=[];
    h.push(`<div class="ep-page-head"><button data-ep="back" ${isMinMonth?'disabled':''}>‹</button><button data-ep="calendar-today">今天</button><div class="ep-month">${y} 年 ${m+1} 月</div><button data-ep="forward">›</button></div>`);
    h.push(`<div class="ep-cal-grid">${['一','二','三','四','五','六','日'].map(x=>`<div class="ep-week">${x}</div>`).join('')}${cells}</div>`);
    h.push(`<div class="ep-section"><div class="ep-section-head"><h3>${selected} · 行程</h3><button data-ep="new-event">＋ 新行程</button></div><div class="ep-list">${eventRows}</div></div>`);
    h.push(`<div class="ep-section ep-editor"><h3>${editing?'編輯行程':'新增行程'}</h3><div class="ep-form-grid">`+
      `<label>日期<input type="date" id="ep-event-date" min="${today()}" value="${editing?esc(editing.date):esc(selected)}"></label>`+
      `<label>擁有者<select id="ep-event-owner">${ownerOptions}</select></label>`+
      `<label>名稱<input id="ep-event-title" value="${editing?esc(editing.title):''}" placeholder="例如：一起看電影"></label>`+
      `<label>開始<input type="time" id="ep-event-start" value="${editing?esc(editing.start||''):''}"></label>`+
      `<label>結束<input type="time" id="ep-event-end" value="${editing?esc(editing.end||''):''}"></label>`+
      `<label class="full">描述<textarea id="ep-event-description" rows="3" placeholder="想提醒角色知道的事情">${editing?esc(editing.description||''):''}</textarea></label>`+
      `</div><div class="ep-check-row"><label><input type="checkbox" id="ep-event-shared" ${shareChecked?'checked':''}> 讓角色看見這個行程</label></div>`+
      `<div class="ep-toolbar"><button data-ep="save-event">保存行程</button>${editingDelete}</div>`+
      `<div class="ep-note">行程日期不可早於今天。若是今天，開始時間也不能早於現在時間。</div></div>`);
    h.push(`<div class="ep-section"><div class="ep-section-head"><div><h3>💕 紀念日</h3><div class="ep-meta">可以是生日、在一起、初遇、領證，或任何值得記住的日子</div></div><button data-ep="new-memorial">＋ 新增紀念日</button></div><div class="ep-list">${memorialRows}</div><div class="ep-note">每年紀念日會自動計算距離下一次還有幾天，也會計算已經過了幾年。紀念日可以由使用者建立，也提供 EPhone AI 指令讓角色自己加入。</div></div>`);
    body.innerHTML=h.join('');
    const owner=root.querySelector('#ep-event-owner');
    if(owner&&editing) owner.value=editing.ownerType==='character'?`character:${editing.characterId}`:'user';
    persist();
  }

  function syncView(){
    const root=document.getElementById('ephone-literary-tools'),body=root.querySelector('.ep-body'),c=chars();
    let sel=body.dataset.char||'__global';
    const cards=sel==='__global'?core.sync.global:(core.sync.byCharacter[sel]||[]);
    const pick=cards.length?cards[Math.floor(Math.random()*cards.length)]:null;
    body.innerHTML=`<div class="ep-page-head"><select id="ep-sync-char" class="ep-select"><option value="__global">全域字卡</option>${c.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · 專屬</option>`).join('')}</select><button data-ep="sync-draw" class="ep-primary-btn">🎲 隨機抽一張</button><button data-ep="sync-add">＋ 新增</button><button data-ep="sync-import">匯入 TXT / JSON</button><button data-ep="sync-export-json">JSON</button><button data-ep="sync-export-txt">TXT</button></div><div class="ep-sync-card"><div class="ep-sync-mark">⌁</div><div class="ep-sync-text">${esc(pick?.text||'還沒有字卡')}</div><div class="ep-sync-kind">${esc(pick?.kind||'狀態')}</div>${pick?'<div class="ep-sync-hint">這張是隨機抽出的字卡</div>':''}</div><div class="ep-section"><div class="ep-section-head"><h3>字卡</h3><span class="ep-meta">一行一句 · 共 ${cards.length} 張</span></div><div class="ep-list">${cards.map(x=>`<div class="ep-row"><div class="ep-row-main"><div class="ep-row-title">${esc(x.text)}</div><div class="ep-meta">${esc(x.kind||'自訂')} · ${x.global?'全域':'角色專屬'}</div></div><button data-ep-sync-del="${esc(x.id)}">刪除</button></div>`).join('')||'<div class="ep-empty">還沒有字卡。</div>'}</div></div>`;
    const s=root.querySelector('#ep-sync-char');if(s)s.value=sel;body.dataset.char=sel;
  }

  function eventFormValue(){
    const root=document.getElementById('ephone-literary-tools');return {
      date:root.querySelector('#ep-event-date')?.value||'',title:root.querySelector('#ep-event-title')?.value.trim()||'',start:root.querySelector('#ep-event-start')?.value||'',end:root.querySelector('#ep-event-end')?.value||'',description:root.querySelector('#ep-event-description')?.value.trim()||'',shared:root.querySelector('#ep-event-shared')?.checked!==false,owner:root.querySelector('#ep-event-owner')?.value||'user'
    };
  }
  function validateEvent(v){
    if(!v.date||v.date<today())return '日期必須是今天或未來。';
    if(!v.title)return '請先寫一個行程名稱。';
    if(v.end&&v.start&&v.end<v.start)return '結束時間不能早於開始時間。';
    if(v.date===today()&&v.start&&v.start<timeKey())return `今天的開始時間必須晚於現在 ${timeKey()}。`;
    return '';
  }
  function saveEvent(){
    const v=eventFormValue(),err=validateEvent(v);if(err){toast('行程沒有保存',err);return}
    const [ownerType,characterId]=v.owner.split(':');
    const base={date:v.date,title:v.title,start:v.start,end:v.end,description:v.description,shared:v.shared,ownerType:ownerType==='character'?'character':'user',characterId:ownerType==='character'?characterId:'',ownerName:ownerType==='character'?charName(characterId):'你',updatedAt:now()};
    const editId=core.calendar.editingId;
    if(editId){const idx=core.calendar.events.findIndex(e=>e.id===editId);if(idx>=0)core.calendar.events[idx]=Object.assign({},core.calendar.events[idx],base)}
    else core.calendar.events.push(Object.assign({id:uid('cal'),createdAt:now()},base));
    core.calendar.selectedDate=v.date;core.calendar.editingId=null;persist();calendarView();toast('已保存','行程已加入共用行事曆。');
  }

  function addSyncLines(lines,kind='自訂',scope='__global'){
    const clean=[];for(const line of lines){const t=String(line??'').trim();if(t)clean.push(t)}
    if(!clean.length) return 0;
    const target=scope==='__global'?core.sync.global:(core.sync.byCharacter[scope]||(core.sync.byCharacter[scope]=[]));
    for(const text of clean)target.push({id:uid('sync'),text,kind,global:scope==='__global',createdAt:now()});
    persist();return clean.length;
  }
  function parseSyncFileData(data,textFallback){
    let items=[];
    if(data!=null){
      const collect=v=>{if(typeof v==='string')items.push({text:v});else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(typeof v.text==='string'||typeof v.content==='string')items.push({text:v.text??v.content,kind:v.kind||v.type});else if(Array.isArray(v.cards))v.cards.forEach(collect);else if(Array.isArray(v.entries))v.entries.forEach(collect);else Object.values(v).forEach(x=>{if(typeof x==='string')items.push({text:x})})}};
      collect(data);
    }
    if(!items.length && textFallback)items=textFallback.split(/\r?\n/).map(text=>({text}));
    return items.map(x=>({text:String(x.text||'').trim(),kind:String(x.kind||'自訂')})).filter(x=>x.text);
  }
  function exportSyncTxt(scope){const cards=scope==='__global'?core.sync.global:(core.sync.byCharacter[scope]||[]);download(`ephone_sync_${scope==='__global'?'global':charName(scope)}.txt`,cards.map(x=>x.text).join('\n'),'text/plain;charset=utf-8')}


  const stEsc=v=>esc(v??'');
  function getSTBookMeta(book){return Object.assign({name:book?.name||'',description:'',scan_depth:100,token_budget:2048,recursive_scanning:true,extensions:{}},book?.stBookMeta||{});}
  function renderSTEntryEditor(book){
    const screen=document.getElementById('world-book-editor-screen'); if(!screen||!book)return;
    let panel=screen.querySelector('.ephone-st-editor');
    if(!panel){
      panel=document.createElement('div'); panel.className='ephone-st-editor';
      screen.querySelector('.form-container')?.appendChild(panel);
    }
    const st=normalizeNativeSTEntry(book.stData||book,Number(book.uid)||0), meta=getSTBookMeta(book);
    const pos=positionNumber(st.position), role=Number(st.role||0);
    const tri=v=>v==null?'inherit':v?'true':'false';
    panel.innerHTML=`
      <div class="st-editor-heading"><div><div class="st-editor-kicker">SILLYTAVERN WORLD INFO</div><h3>Entry 設定</h3></div><span class="st-editor-uid">UID ${st.uid}</span></div>
      <div class="st-editor-section"><h4>書籍設定</h4><div class="st-grid">
        <label>書籍描述<textarea id="st-book-description" rows="2">${stEsc(meta.description)}</textarea></label>
        <label>Scan Depth<input id="st-book-scan-depth" type="number" min="0" value="${Number(meta.scan_depth??100)}"></label>
        <label>Token Budget<input id="st-book-token-budget" type="number" min="0" value="${Number(meta.token_budget??2048)}"></label>
        <label class="st-inline-check"><input id="st-book-recursive" type="checkbox" ${meta.recursive_scanning!==false?'checked':''}> Recursive Scanning</label>
      </div></div>
      <div class="st-editor-section"><h4>觸發與內容</h4><div class="st-grid">
        <label>Memo / Entry 名稱<input id="st-comment" value="${stEsc(st.comment)}"></label>
        <label>UID<input id="st-uid" type="number" value="${Number(st.uid)}"></label>
        <label class="full">Primary Keys<textarea id="st-key" rows="2" placeholder="一個關鍵詞一行，或逗號分隔">${stEsc(st.key.join(', '))}</textarea></label>
        <label class="full">Secondary Keys / Optional Filter<textarea id="st-secondary" rows="2" placeholder="選擇性觸發的第二組關鍵詞">${stEsc(st.keysecondary.join(', '))}</textarea></label>
        <label class="full">Content<textarea id="st-content" rows="8" placeholder="觸發後插入提示詞的內容">${stEsc(st.content)}</textarea></label>
      </div></div>
      <div class="st-editor-section"><h4>插入位置與深度</h4><div class="st-grid">
        <label>Position<select id="st-position">${Object.entries(ST_POSITION_LABELS).map(([k,v])=>`<option value="${k}" ${Number(k)===pos?'selected':''}>${v}</option>`).join('')}</select></label>
        <label>Depth<input id="st-depth" type="number" min="0" value="${Number(st.depth??4)}"></label>
        <label>Role<select id="st-role"><option value="0" ${role===0?'selected':''}>System</option><option value="1" ${role===1?'selected':''}>User</option><option value="2" ${role===2?'selected':''}>Assistant</option></select></label>
        <label>Scan Depth Override<input id="st-scan-depth" type="number" min="0" placeholder="跟隨書籍設定" value="${st.scanDepth==null?'':Number(st.scanDepth)}"></label>
        <label>Insertion Order<input id="st-order" type="number" value="${Number(st.order??100)}"></label>
        <label>Display Index<input id="st-display-index" type="number" value="${Number(st.displayIndex??st.uid??0)}"></label>
        <label>Probability %<input id="st-probability" type="number" min="0" max="100" value="${Number(st.probability??100)}"></label>
      </div><div class="st-position-hint">ST Position 0–7：角色前、角色後、AN 頂、AN 底、@D、示例前、示例後、Outlet。只有 @D 會真正使用 Depth；角色卡 V2 的限制欄位會另外保存在 extensions.st。</div></div>
      <div class="st-editor-section"><h4>匹配與分組</h4><div class="st-grid">
        <label>Selective Logic<select id="st-selective-logic"><option value="0" ${Number(st.selectiveLogic)===0?'selected':''}>AND ANY</option><option value="1" ${Number(st.selectiveLogic)===1?'selected':''}>NOT ALL</option><option value="2" ${Number(st.selectiveLogic)===2?'selected':''}>NOT ANY</option><option value="3" ${Number(st.selectiveLogic)===3?'selected':''}>AND ALL</option></select></label>
        <label>Group<input id="st-group" value="${stEsc(st.group)}"></label>
        <label>Group Weight<input id="st-group-weight" type="number" min="0" value="${Number(st.groupWeight??100)}"></label>
        <label>Case Sensitive<select id="st-case"><option value="inherit" ${tri(st.caseSensitive)==='inherit'?'selected':''}>跟隨全域</option><option value="true" ${tri(st.caseSensitive)==='true'?'selected':''}>是</option><option value="false" ${tri(st.caseSensitive)==='false'?'selected':''}>否</option></select></label>
        <label>Match Whole Words<select id="st-whole"><option value="inherit" ${tri(st.matchWholeWords)==='inherit'?'selected':''}>跟隨全域</option><option value="true" ${tri(st.matchWholeWords)==='true'?'selected':''}>是</option><option value="false" ${tri(st.matchWholeWords)==='false'?'selected':''}>否</option></select></label>
        <label class="st-inline-check"><input id="st-constant" type="checkbox" ${st.constant?'checked':''}> Constant / 始終觸發</label>
        <label class="st-inline-check"><input id="st-selective" type="checkbox" ${st.selective?'checked':''}> Selective / 使用 Secondary Keys</label>
        <label class="st-inline-check"><input id="st-enabled" type="checkbox" ${!st.disable?'checked':''}> Enabled</label>
        <label class="st-inline-check"><input id="st-exclude" type="checkbox" ${st.excludeRecursion?'checked':''}> Exclude Recursion</label>
        <label class="st-inline-check"><input id="st-prevent" type="checkbox" ${st.preventRecursion?'checked':''}> Prevent Recursion</label>
        <label class="st-inline-check"><input id="st-group-override" type="checkbox" ${st.groupOverride?'checked':''}> Prioritize Inclusion</label>
        <label class="st-inline-check"><input id="st-group-score" type="checkbox" ${st.useGroupScoring?'checked':''}> Use Group Scoring</label>
      </div></div>
      <div class="st-editor-section"><h4>進階</h4><div class="st-grid">
        <label>Outlet Name<input id="st-outlet" value="${stEsc(st.outletName)}" placeholder="僅 Position = Outlet 時使用"></label>
        <label>Automation ID<input id="st-automation" value="${stEsc(st.automationId)}"></label>
        <label class="full">Character Filter Names<textarea id="st-char-names" rows="2">${stEsc((st.characterFilter?.names||[]).join(', '))}</textarea></label>
        <label class="full">Character Filter Tags<textarea id="st-char-tags" rows="2">${stEsc((st.characterFilter?.tags||[]).join(', '))}</textarea></label>
        <label class="st-inline-check"><input id="st-char-exclude" type="checkbox" ${st.characterFilter?.isExclude?'checked':''}> Character Filter：Exclude</label>
        <label class="st-inline-check"><input id="st-use-regex" type="checkbox" ${st.useRegex?'checked':''}> Use Regex</label>
        <label class="st-inline-check"><input id="st-ignore-budget" type="checkbox" ${st.ignoreBudget?'checked':''}> Ignore Budget</label>
        <label class="full">Triggers<select id="st-triggers" multiple size="4"><option value="normal">Normal</option><option value="continue">Continue</option><option value="impersonate">Impersonate</option><option value="swipe">Swipe</option><option value="regenerate">Regenerate</option><option value="quiet">Quiet</option></select></label>
        <label>Sticky<input id="st-sticky" type="number" min="0" value="${st.sticky==null?'':Number(st.sticky)}" placeholder="0 / 空"></label>
        <label>Cooldown<input id="st-cooldown" type="number" min="0" value="${st.cooldown==null?'':Number(st.cooldown)}" placeholder="0 / 空"></label>
        <label>Delay<input id="st-delay" type="number" min="0" value="${st.delay==null?'':Number(st.delay)}" placeholder="0 / 空"></label>
        <label class="st-inline-check"><input id="st-vectorized" type="checkbox" ${st.vectorized?'checked':''}> Vectorized</label>
      </div></div>`;
    const triggerSelect=panel.querySelector('#st-triggers');
    (st.triggers||[]).forEach(v=>{const o=triggerSelect?.querySelector(`option[value="${String(v).replace(/"/g,'')}"]`);if(o)o.selected=true});
    const posEl=panel.querySelector('#st-position'), depthEl=panel.querySelector('#st-depth'), roleEl=panel.querySelector('#st-role');
    const updatePos=()=>{const at=Number(posEl.value)===4;depthEl.disabled=!at;roleEl.disabled=!at;panel.classList.toggle('at-depth',at)};
    posEl.onchange=updatePos; updatePos();
  }
  function readSTEntryEditor(book){
    const p=document.querySelector('.ephone-st-editor'); if(!p)return null;
    const triVal=id=>{const v=p.querySelector(id)?.value;return v==='inherit'?null:v==='true'};
    const st=normalizeNativeSTEntry(book.stData||book,Number(p.querySelector('#st-uid')?.value||book.uid||0));
    st.uid=Number(p.querySelector('#st-uid')?.value||st.uid||0); st.comment=p.querySelector('#st-comment')?.value.trim()||'';
    st.name=st.comment; st.key=splitKeys(p.querySelector('#st-key')?.value||''); st.keysecondary=splitKeys(p.querySelector('#st-secondary')?.value||'');
    st.content=p.querySelector('#st-content')?.value||''; st.position=Number(p.querySelector('#st-position')?.value||0); st.depth=Number(p.querySelector('#st-depth')?.value||4); st.role=Number(p.querySelector('#st-role')?.value||0);
    const sd=p.querySelector('#st-scan-depth')?.value; st.scanDepth=sd===''?null:Number(sd); st.order=Number(p.querySelector('#st-order')?.value||100); st.probability=Math.max(0,Math.min(100,Number(p.querySelector('#st-probability')?.value||100)));
    st.selectiveLogic=Number(p.querySelector('#st-selective-logic')?.value||0); st.group=p.querySelector('#st-group')?.value||''; st.groupWeight=Number(p.querySelector('#st-group-weight')?.value||100);
    st.caseSensitive=triVal('#st-case'); st.matchWholeWords=triVal('#st-whole'); st.constant=!!p.querySelector('#st-constant')?.checked; st.selective=!!p.querySelector('#st-selective')?.checked; st.disable=!p.querySelector('#st-enabled')?.checked;
    st.excludeRecursion=!!p.querySelector('#st-exclude')?.checked; st.preventRecursion=!!p.querySelector('#st-prevent')?.checked; st.groupOverride=!!p.querySelector('#st-group-override')?.checked; st.useGroupScoring=!!p.querySelector('#st-group-score')?.checked;
    st.displayIndex=Number(p.querySelector('#st-display-index')?.value||st.uid||0); st.outletName=p.querySelector('#st-outlet')?.value.trim()||''; st.automationId=p.querySelector('#st-automation')?.value.trim()||'';
    st.triggers=[...(p.querySelector('#st-triggers')?.selectedOptions||[])].map(o=>o.value);
    const numOrNull=id=>{const v=p.querySelector(id)?.value;return v===''||v==null?null:Number(v)}; st.sticky=numOrNull('#st-sticky'); st.cooldown=numOrNull('#st-cooldown'); st.delay=numOrNull('#st-delay'); st.vectorized=!!p.querySelector('#st-vectorized')?.checked;
    st.characterFilter={isExclude:!!p.querySelector('#st-char-exclude')?.checked,names:splitKeys(p.querySelector('#st-char-names')?.value||''),tags:splitKeys(p.querySelector('#st-char-tags')?.value||'')}; st.useRegex=!!p.querySelector('#st-use-regex')?.checked; st.ignoreBudget=!!p.querySelector('#st-ignore-budget')?.checked;
    st.extensions=Object.assign({},st.extensions,{ephone:Object.assign({},st.extensions.ephone||{}, {st:{position:st.position,depth:st.depth,role:st.role,scanDepth:st.scanDepth,probability:st.probability,useProbability:true,selectiveLogic:st.selectiveLogic,group:st.group,groupOverride:st.groupOverride,groupWeight:st.groupWeight,useGroupScoring:st.useGroupScoring,outletName:st.outletName,automationId:st.automationId,useRegex:st.useRegex,ignoreBudget:st.ignoreBudget,characterFilter:deep(st.characterFilter),excludeRecursion:st.excludeRecursion,preventRecursion:st.preventRecursion,delayUntilRecursion:st.delayUntilRecursion,vectorized:st.vectorized,addMemo:st.addMemo,displayIndex:st.displayIndex,triggers:deep(st.triggers),sticky:st.sticky,cooldown:st.cooldown,delay:st.delay}})});
    const meta={name:book.name||'',description:p.querySelector('#st-book-description')?.value||'',scan_depth:Number(p.querySelector('#st-book-scan-depth')?.value||100),token_budget:Number(p.querySelector('#st-book-token-budget')?.value||2048),recursive_scanning:!!p.querySelector('#st-book-recursive')?.checked,extensions:book.stBookMeta?.extensions||{}};
    return {st,meta};
  }
  function installSTWorldEditorBridge(){
    const list=document.getElementById('world-book-list'),save=document.getElementById('save-world-book-btn'),editor=document.getElementById('world-book-editor-screen');
    if(!list||!save||!editor)return;
    list.addEventListener('click',e=>{const item=e.target.closest('.list-item');if(item?.dataset.bookId){window.__ephoneEditingWorldBookId=item.dataset.bookId;setTimeout(()=>{const b=window.state?.worldBooks?.find(x=>x.id===window.__ephoneEditingWorldBookId);if(b)renderSTEntryEditor(b)},0)}},true);
    save.addEventListener('click',async e=>{
      const id=window.__ephoneEditingWorldBookId;if(!id)return;
      const book=window.state?.worldBooks?.find(x=>x.id===id);if(!book)return;
      e.preventDefault();e.stopImmediatePropagation();
      const result=readSTEntryEditor(book);if(!result)return;
      book.name=document.getElementById('world-book-name-input')?.value.trim()||book.name||'未命名'; book.content=result.st.content; book.uid=result.st.uid; book.keys=result.st.key.join(', ');book.secondaryKeys=result.st.keysecondary.join(', ');book.enabled=!result.st.disable;book.constant=result.st.constant;book.order=result.st.order;book.position=result.st.position;book.role=result.st.role;book.stData=result.st;book.stBookMeta=result.meta;
      await window.db?.worldBooks?.put?.(book); if(window.state)window.state.worldBooks=await window.db.worldBooks.toArray();
      window.renderWorldBookScreenProxy?.(); window.__ephoneEditingWorldBookId=null; showScreen('world-book-screen');
    },true);
    const obs=new MutationObserver(()=>{if(editor.classList.contains('active')||getComputedStyle(editor).display!=='none'){const id=window.__ephoneEditingWorldBookId;const b=window.state?.worldBooks?.find(x=>x.id===id);if(b&&!editor.querySelector('.ephone-st-editor'))renderSTEntryEditor(b)}});
    obs.observe(editor,{attributes:true,attributeFilter:['class','style']});
    setTimeout(()=>{const b=window.state?.worldBooks?.find(x=>x.id===window.__ephoneEditingWorldBookId);if(b)renderSTEntryEditor(b)},400);
  }
  function init(){
    const wrap=document.createElement('div');wrap.id='ephone-literary-tools';wrap.innerHTML=`<div class="ep-modal"><div class="ep-sheet"><div class="ep-sheet-head"><div><div class="ep-title">EPhone · 文青工具箱</div><div class="ep-sub">角色、世界、時間，安靜地放在一起。</div></div><button data-ep="close" class="ep-close">×</button></div><div class="ep-body"></div></div></div>
      <div class="ep-dialog-modal"><div class="ep-dialog-card"><div class="ep-dialog-title"></div><div class="ep-dialog-body"></div><div class="ep-dialog-actions"><button data-ep-dialog-cancel>取消</button><button class="primary" data-ep-dialog-ok>保存</button></div></div></div>
      <div class="ep-toast"><div class="ep-toast-title"></div><div class="ep-toast-text"></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.ep-modal').addEventListener('click',async e=>{
      if(e.target===e.currentTarget){close();return}
      const b=e.target.closest('[data-ep]');if(!b)return;const a=b.dataset.ep;
      if(a==='close'){close();return}
      if(a==='calendar'){core.calendar.editingId=null;calendarView();return}
      if(a==='sync'){syncView();return}
      if(a==='sync-draw'){syncView();return}
      if(a==='calendar-today'){core.calendar.viewDate=`${today().slice(0,7)}-01`;core.calendar.selectedDate=today();core.calendar.editingId=null;calendarView();return}
      if(a==='back'||a==='forward'){let d=new Date(core.calendar.viewDate+'T12:00:00');d.setMonth(d.getMonth()+(a==='back'?-1:1));const nd=new Date(d.getFullYear(),d.getMonth(),1);if(dateKey(nd).slice(0,7)+'-01'>=`${today().slice(0,7)}-01`){core.calendar.viewDate=dateKey(nd);calendarView()}return}
      if(a==='new-event'){core.calendar.editingId=null;core.calendar.selectedDate=core.calendar.selectedDate&&core.calendar.selectedDate>=today()?core.calendar.selectedDate:today();calendarView();return}
      if(a==='save-event'){saveEvent();return}
      if(a==='delete-editing'){const id=core.calendar.editingId;if(id){core.calendar.events=core.calendar.events.filter(x=>x.id!==id);core.calendar.editingId=null;persist();calendarView();toast('已刪除','行程已從共用行事曆移除。')}return}
      if(a==='new-memorial'){
        const result=await showDialog('memorial',{title:'新增紀念日',okText:'加入',html:`<div class="ep-form-grid"><label>名稱<input id="ep-mem-title" placeholder="例如：我們在一起"></label><label>類型<select id="ep-mem-type"><option>在一起</option><option>生日</option><option>初遇</option><option>結婚／領證</option><option>其他</option></select></label><label>日期<input id="ep-mem-date" type="date"></label><label class="full">備註<textarea id="ep-mem-desc" rows="3" placeholder="例如：第一次正式告白的日子"></textarea></label></div><div class="ep-check-row"><label><input id="ep-mem-annual" type="checkbox" checked> 每年重複計算</label></div>`,collect:b=>({title:b.querySelector('#ep-mem-title').value,date:b.querySelector('#ep-mem-date').value,type:b.querySelector('#ep-mem-type').value,description:b.querySelector('#ep-mem-desc').value,annual:b.querySelector('#ep-mem-annual').checked})});
        if(result){try{addMemorialDay(result);calendarView();toast('已加入','紀念日已保存。')}catch(err){toast('新增失敗',err.message)}}return;
      }
      if(a==='sync-add'){
        const scope=wrap.querySelector('.ep-body').dataset.char||'__global';
        const result=await showDialog('sync',{title:'新增同頻字卡',okText:'加入',html:`<label class="ep-field-label">一句一句輸入</label><textarea id="ep-sync-lines-input" class="ep-dialog-textarea" rows="7" placeholder="每一行就是一張字卡\n例如：\n今晚一起看月亮\n我現在很想你\n記得帶傘"></textarea><label class="ep-field-label">分類</label><input id="ep-sync-kind-input" class="ep-dialog-input" value="狀態" placeholder="狀態 / 心情 / 自訂">`,collect:body=>({text:body.querySelector('#ep-sync-lines-input').value,kind:body.querySelector('#ep-sync-kind-input').value.trim()||'自訂'})});
        if(result){const n=addSyncLines(result.text.split(/\r?\n/),result.kind,scope);syncView();toast('已加入',`新增 ${n} 張同頻字卡。`)}return;
      }
      if(a==='sync-import'){wrap.querySelector('#ep-sync-file-input')?.click();return}
      if(a==='sync-export-json'){const scope=wrap.querySelector('.ep-body').dataset.char||'__global';const cards=scope==='__global'?core.sync.global:(core.sync.byCharacter[scope]||[]);download(`ephone_sync_${scope==='__global'?'global':charName(scope)}.json`,cards.map(x=>({text:x.text,kind:x.kind||'自訂'})));return}
      if(a==='sync-export-txt'){exportSyncTxt(wrap.querySelector('.ep-body').dataset.char||'__global');return}
      if(a==='st-import'){document.getElementById('ep-st-world-input')?.click();return}
      if(a==='st-export'){download('ephone_world_info.json',worldExport());toast('已匯出','這是 SillyTavern 原生 World Info 的 entries 物件格式。');return}
      if(a==='char-export'){const id=document.getElementById('ep-char-select')?.value;if(id)characterExport(id);else toast('尚未選角色','請先選擇一個角色。');return}
      if(a==='char-copy'){const id=document.getElementById('ep-char-select')?.value;if(!id){toast('尚未選角色','請先選擇一個角色。');return}try{await navigator.clipboard?.writeText(JSON.stringify(characterToV2(chars().find(x=>x.id===id)),null,2));toast('已複製','Character Card V2 JSON 已放入剪貼簿。')}catch{toast('複製失敗','瀏覽器拒絕了剪貼簿存取。')}return}
    });
    wrap.addEventListener('click',e=>{
      const day=e.target.closest('[data-ep-day]');if(day&&!day.disabled){core.calendar.selectedDate=day.dataset.epDay;core.calendar.editingId=null;calendarView()}
      const edit=e.target.closest('[data-ep-edit]');if(edit){core.calendar.editingId=edit.dataset.epEdit;const found=core.calendar.events.find(x=>x.id===core.calendar.editingId);core.calendar.selectedDate=found?.date||today();calendarView()}
      const memDel=e.target.closest('[data-ep-mem-del]');if(memDel){removeMemorialDay(memDel.dataset.epMemDel);calendarView();toast('已刪除','紀念日已移除。');return}
      const memEdit=e.target.closest('[data-ep-mem-edit]');if(memEdit){const m=core.calendar.memorialDays.find(x=>x.id===memEdit.dataset.epMemEdit);if(!m)return;showDialog('memorial-edit',{title:'編輯紀念日',okText:'保存',html:`<div class="ep-form-grid"><label>名稱<input id="ep-mem-title" value="${esc(m.title)}"></label><label>類型<select id="ep-mem-type"><option ${m.type==='在一起'?'selected':''}>在一起</option><option ${m.type==='生日'?'selected':''}>生日</option><option ${m.type==='初遇'?'selected':''}>初遇</option><option ${m.type==='結婚／領證'?'selected':''}>結婚／領證</option><option ${!['在一起','生日','初遇','結婚／領證'].includes(m.type)?'selected':''}>其他</option></select></label><label>日期<input id="ep-mem-date" type="date" value="${esc(m.date)}"></label><label class="full">備註<textarea id="ep-mem-desc" rows="3">${esc(m.description||'')}</textarea></label></div><div class="ep-check-row"><label><input id="ep-mem-annual" type="checkbox" ${m.annual!==false?'checked':''}> 每年重複計算</label></div>`,collect:b=>({title:b.querySelector('#ep-mem-title').value,date:b.querySelector('#ep-mem-date').value,type:b.querySelector('#ep-mem-type').value,description:b.querySelector('#ep-mem-desc').value,annual:b.querySelector('#ep-mem-annual').checked})}).then(r=>{if(r){try{updateMemorialDay(m.id,r);calendarView();toast('已保存','紀念日已更新。')}catch(err){toast('保存失敗',err.message)}}});return}
      const del=e.target.closest('[data-ep-sync-del]');if(del){const body=wrap.querySelector('.ep-body'),sel=body?.dataset.char||'__global';if(sel==='__global')core.sync.global=core.sync.global.filter(x=>x.id!==del.dataset.epSyncDel);else core.sync.byCharacter[sel]=(core.sync.byCharacter[sel]||[]).filter(x=>x.id!==del.dataset.epSyncDel);persist();syncView()}
    });
    wrap.addEventListener('change',e=>{if(e.target.id==='ep-sync-char'){wrap.querySelector('.ep-body').dataset.char=e.target.value;syncView()}});
    const wbInput=document.createElement('input');wbInput.type='file';wbInput.accept='.json,.jsonl';wbInput.hidden=true;wbInput.id='ep-st-world-input';document.body.appendChild(wbInput);wbInput.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());const n=await importWorldObject(data,f.name.replace(/\.jsonl?$/i,''));toast('匯入成功',`已匯入 ${n} 條 SillyTavern World Info entry。`)}catch(err){toast('匯入失敗',err.message)}finally{e.target.value=''}})
    const syncInput=document.createElement('input');syncInput.type='file';syncInput.accept='.txt,.json';syncInput.hidden=true;syncInput.id='ep-sync-file-input';document.body.appendChild(syncInput);syncInput.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const text=await f.text();let data=null;try{data=JSON.parse(text)}catch{}const items=parseSyncFileData(data,data?null:text);const scope=wrap.querySelector('.ep-body').dataset.char||'__global';const target=scope==='__global'?core.sync.global:(core.sync.byCharacter[scope]||(core.sync.byCharacter[scope]=[]));for(const item of items)target.push({id:uid('sync'),text:item.text,kind:item.kind,global:scope==='__global',createdAt:now()});persist();syncView();toast('匯入成功',`已加入 ${items.length} 張字卡。`)}catch(err){toast('匯入失敗',err.message)}finally{e.target.value=''}})
    setTimeout(installSTWorldEditorBridge, 500);
    window.EPhoneCore={get data(){return core},save:persist,characterToV2,exportCharacter:characterExport,worldExport,importWorldObject,calendarContext,memorialContext,addMemorialDay,updateMemorialDay,removeMemorialDay,syncContext,chatContext,download,splitKeys,openCalendar,openSync,toast};
    window.exportEPhoneCharacterV2=(id)=>characterExport(id);
    window.exportEPhoneWorldInfo=()=>download('ephone_world_info.json',worldExport());
    window.EPhoneCore.ready=true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
