(function(){
  'use strict';
  const STYLE_ID='ephone-watch-style';
  const MODAL_ID='ephone-watch-modal';
  const PLAYER_ID='ephone-watch-player';
  let player=null, apiReady=null, currentUrl='', lastAnalyzed=0, timer=null, busy=false;
  let messages=[], contextCache=new Map();

  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function youtubeId(url){
    try{
      const u=new URL(url);
      if(u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
      if(u.hostname.includes('youtube.com')){
        if(u.pathname==='/watch') return u.searchParams.get('v');
        if(u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
        if(u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
      }
    }catch(_){ }
    return null;
  }
  function loadYT(){
    if(window.YT?.Player) return Promise.resolve();
    if(apiReady) return apiReady;
    apiReady=new Promise((resolve,reject)=>{
      const old=window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady=()=>{try{old?.();}catch(_){} resolve();};
      const s=document.createElement('script'); s.src='https://www.youtube.com/iframe_api'; s.async=true;
      s.onerror=()=>reject(new Error('YouTube 播放器 API 載入失敗')); document.head.appendChild(s);
    });
    return apiReady;
  }
  function cfg(){return window.state?.apiConfig||{};}
  function nativeEndpoint(){
    const c=cfg();
    let p=String(c.proxyUrl||'').trim().replace(/\/+$/,'');
    if(!p) throw new Error('請先在 EPhone API 設定填入反代地址。');
    // 目前 EPhone 的反代通常填 /v1；Gemini 原生端點位於同一站的 /v1beta。
    if(/\/v1$/i.test(p)) p=p.slice(0,-3);
    return `${p}/v1beta/models/${encodeURIComponent(String(c.model||'').trim())}:generateContent`;
  }
  function getChat(){
    const id=document.getElementById('ephone-watch-character')?.value;
    return id && window.state?.chats?.[id] ? window.state.chats[id] : null;
  }
  function getWatchTheme(){
    return window.state?.globalSettings?.ephoneUserTheme?.thirdApps || {};
  }
  function refreshAppAppearance(){
    const b=document.getElementById('ephone-watch-app');
    if(!b) return;
    const t=getWatchTheme();
    const name=String(t.watchName||'共同觀影').trim()||'共同觀影';
    const icon=String(t.watchIcon||'').trim();
    b.innerHTML=icon
      ? `<span class="ephone-third-icon has-custom-image"><img src="${esc(icon)}" alt=""></span><span class="ephone-third-app-name">${esc(name)}</span><span class="ephone-third-app-desc">貼 YouTube，讓 AI 一起看</span>`
      : `<span class="ephone-third-icon">🎬</span><span class="ephone-third-app-name">${esc(name)}</span><span class="ephone-third-app-desc">貼 YouTube，讓 AI 一起看</span>`;
  }
  function getVideoTitle(){
    try { return String(player?.getVideoData?.()?.title || '').trim(); } catch(_) { return ''; }
  }
  async function persistChat(chat){
    try{
      if(window.EPhoneDB?.chats?.put) await window.EPhoneDB.chats.put(chat);
      else if(window.db?.chats?.put) await window.db.chats.put(chat);
      else if(window.state?.db?.chats?.put) await window.state.db.chats.put(chat);
      else if(window.state?.activeChatId && window.saveChatToDB) await window.saveChatToDB(chat);
      else {
        // v35 的 db 在閉包內不可直接取得；交給主程式暴露的保存橋接。
        if(typeof window.EPhoneSaveChat==='function') await window.EPhoneSaveChat(chat);
      }
    }catch(e){ console.warn('[EPhone Watch] 保存觀影記憶失敗',e); }
  }
  async function saveWatchMemory({start,end,userText,assistantText,videoText=''}){
    const chat=getChat();
    if(!chat || !Array.isArray(chat.history)) return;
    if(!chat.settings) chat.settings={};
    if(!Array.isArray(chat.settings.watchMemories)) chat.settings.watchMemories=[];
    const title=getVideoTitle() || '未命名影片';
    const timeRange=`${fmt(start)}–${fmt(end)}`;
    const url=currentUrl;
    const key=`${url}|${Math.floor(start/30)}|${Math.floor(end/30)}`;
    const user=String(userText||'').trim();
    const reply=String(assistantText||'').trim();
    const clip=String(videoText||'').trim();
    if(!user && !reply) return;
    const lines=[`共同觀影《${title}》 · ${timeRange}`];
    if(clip) lines.push(`觀影片段與角色回應：${clip.slice(0,700)}`);
    if(user) lines.push(`使用者談論：${user.slice(0,500)}`);
    if(reply) lines.push(`角色回應：${reply.slice(0,700)}`);
    const memoryText=lines.join('；');

    // 角色自己的「對話記憶」：寫入 hidden summary，舊有私聊 prompt 會自動讀到。
    const existingSummary=chat.history.find(m=>m.type==='summary' && m.watchMemoryKey===key);
    if(existingSummary){
      const addition=`追加討論：${user ? `使用者談論：${user.slice(0,500)}` : ''}${reply ? `；角色回應：${reply.slice(0,700)}` : ''}`;
      existingSummary.content=(existingSummary.content + '\n' + addition).slice(-2200);
      existingSummary.timestamp=Date.now();
    }else{
      chat.history.push({
        role:'system', type:'summary', isHidden:true, timestamp:Date.now(),
        watchMemory:true, watchMemoryKey:key, content:memoryText.slice(0,2200)
      });
    }
    // 同時保留一份輕量索引，供觀影記憶區與 prompt 快速讀取，最多 24 條。
    const idx=chat.settings.watchMemories.findIndex(m=>m.key===key);
    if(idx>=0){
      const previous=chat.settings.watchMemories[idx];
      chat.settings.watchMemories[idx]={...previous,text:(previous.text+'\n'+(user||reply ? `追加討論：${user ? `使用者談論：${user.slice(0,500)}` : ''}${reply ? `；角色回應：${reply.slice(0,700)}` : ''}` : '')).slice(-2200),updatedAt:Date.now()};
    }else{
      chat.settings.watchMemories.push({key,title,timeRange,url,text:memoryText.slice(0,2200),updatedAt:Date.now()});
    }
    chat.settings.watchMemories=chat.settings.watchMemories.slice(-24);
    await persistChat(chat);
  }
  function cleanText(v, max=9000){
    const s=String(v ?? '').trim();
    return s.length>max ? s.slice(0,max)+'\n[以下角色資料已截斷]' : s;
  }
  function getCharacterProfile(chat){
    if(!chat) return {name:'AI 觀影夥伴', persona:'沒有指定角色。', extras:''};
    const st=chat.stCharacterData || chat.characterData || {};
    const persona=cleanText(chat.settings?.aiPersona || st.personality || st.description || chat.description || '該角色沒有明確人設。',12000);
    const extras=[];
    if(chat.relationship?.status) extras.push(`目前关系状态：${cleanText(chat.relationship.status,300)}`);
    if(chat.status?.text) extras.push(`当前状态：${cleanText(chat.status.text,500)}`);
    if(st.personality && st.personality!==persona) extras.push(`性格补充：${cleanText(st.personality,5000)}`);
    if(st.scenario) extras.push(`角色原始情境：${cleanText(st.scenario,3500)}`);
    if(st.system_prompt) extras.push(`角色卡原始系統提示：${cleanText(st.system_prompt,5000)}`);
    if(st.post_history_instructions) extras.push(`角色卡回覆規則：${cleanText(st.post_history_instructions,4000)}`);
    if(st.mes_example) extras.push(`角色語氣示例（僅作語氣參考，不得照抄）：${cleanText(st.mes_example,4500)}`);
    return {name:chat.name||'未命名角色', persona, extras:extras.join('\n')};
  }
  function getRoleLock(chat){
    const profile=getCharacterProfile(chat);
    return `你現在是「${profile.name}」，不是影片旁白、影評人、助手，也不是影片中的任何角色。\n\n【角色核心設定，最高優先級】\n${profile.persona}\n${profile.extras ? '\n【角色卡補充資料】\n'+profile.extras : ''}\n\n【共同觀影角色鎖定規則】\n1. 无论影片里出现谁，你都只能以「${profile.name}」的身份回应；绝对不要把影片角色的性格、立场、说话方式、身份或情绪套到自己身上。\n2. 影片内容只是你正在观看的外部事件，不是你的新设定。影片中的人物不是你，影片旁白也不是你的内心。\n3. 你的价值观、说话习惯、称呼、关系、知识边界必须优先遵守上述角色设定；如果影片内容与你的人设冲突，保留你的人设，只讨论影片。\n4. 不要因为影片内容而突然变得过度热情、过度温柔、过度毒舌、说教、卖萌、油腻、文艺或戏剧化，除非这些本来就是你的人设。\n5. 不要替用户说话、替用户行动、替用户下结论。你只回应用户真正说出的内容。\n6. 不要凭空增加你与用户之间没有建立过的关系、承诺、回忆或经历。\n7. 不要为了回应影片而机械复述剧情。优先像这个角色本人一样发表反应、判断、吐槽、疑问或简短评论。\n8. 不要输出“作为AI”“根据提示”“我无法真正观看”等出戏内容。\n9. 如果影片信息不足以确定某件事，明确保持不确定，而不是为了显得懂而编造。\n10. 影片分析负责告诉你“发生了什么”，角色设定负责决定“你会怎么想、怎么说”。两者不可混淆。\n\n【语气稳定】\n以角色设定为主，最近角色消息只作为次要的语气参考。不要因为影片内容改变原本的语言风格。`;
  }
  function getExistingChatContext(chat){
    if(!chat?.history?.length) return '';
    const recent=chat.history.filter(m=>!m.isHidden && m.type!=='summary').slice(-6).map(m=>{
      const who=m.role==='user' ? '使用者' : (m.senderName || chat.name || '角色');
      return `${who}：${cleanText(m.content,900)}`;
    }).join('\n');
    return recent ? `\n【角色与使用者既有对话，仅用于保持关系与语气连续】\n${recent}` : '';
  }
  function getWatchWorldContext(chat){
    if(!chat?.settings?.linkedWorldBookIds?.length) return '';
    const parts=chat.settings.linkedWorldBookIds.map(id=>{
      const book=window.state?.worldBooks?.find(b=>b.id===id);
      return book?.content ? `## 世界书：${book.name}\n${cleanText(book.content,5000)}` : '';
    }).filter(Boolean);
    return parts.length ? `\n【角色相关世界书，必须遵守】\n${parts.join('\n\n')}` : '';
  }
  function fillChars(){
    const sel=document.getElementById('ephone-watch-character'); if(!sel)return;
    const chats=Object.values(window.state?.chats||{}).filter(c=>!c.isGroup);
    sel.innerHTML='<option value="">不指定角色</option>'+chats.map(c=>`<option value="${esc(c.id)}">${esc(c.name||'未命名角色')}</option>`).join('');
    if(window.state?.activeChatId && chats.some(c=>c.id===window.state.activeChatId)) sel.value=window.state.activeChatId;
  }
  function modal(){
    if(document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);
    const d=document.createElement('div'); d.id=MODAL_ID; d.hidden=true;
    d.innerHTML=`<div class="ep-watch-backdrop" data-watch-close></div><section class="ep-watch-panel">
      <header class="ep-watch-head"><div><div class="ep-watch-kicker">EPHONE · WATCH TOGETHER</div><div class="ep-watch-title">🎬 AI 共同觀影</div><div class="ep-watch-subtitle">像聊天一樣一起看，只有你提到劇情時才讓 AI 讀影片。</div></div><button type="button" class="ep-watch-close" data-watch-close>×</button></header>
      <div class="ep-watch-body">
        <div class="ep-watch-url-row"><input id="ephone-watch-url" placeholder="貼上公開 YouTube 連結，例如 https://youtu.be/..." autocomplete="off"><button id="ephone-watch-load">載入影片</button></div>
        <div class="ep-watch-grid"><div class="ep-watch-video"><div id="ephone-watch-player"></div><div class="ep-watch-time" id="ephone-watch-time">尚未載入影片</div></div>
        <aside class="ep-watch-side"><label>觀影角色<select id="ephone-watch-character"><option value="">不指定角色</option></select></label><label class="ep-watch-check"><input id="ephone-watch-auto" type="checkbox" checked> 提到劇情時自動讀取影片</label><label>觀影提示<textarea id="ephone-watch-prompt">你正在與使用者一起看影片。影片只是你們共同觀看的外部內容，不會改變你的角色身份。只有在使用者提到劇情、角色、畫面、台詞、剛才發生的事情，或明確要求你看某一段時，才依目前時間附近的影片內容回答。回答時必須保持你原本的人設、說話習慣、價值觀與你和使用者既有的關係；不要模仿影片角色，不要變成影評人，不要替使用者發言，不要假裝看過尚未讀取的片段。</textarea></label><button id="ephone-watch-analyze" class="primary">🎬 看目前這一段</button><div class="ep-watch-status" id="ephone-watch-status">等待影片</div></aside></div>
        <div class="ep-watch-chat" id="ephone-watch-chat"><div class="ep-watch-empty">載入影片後，你可以直接在這裡聊天。平常聊天不會呼叫影片 API，提到劇情時才會讀取目前片段。</div></div>
        <div class="ep-watch-compose"><textarea id="ephone-watch-input" rows="2" placeholder="例如：你有沒有注意到他剛才那個表情？"></textarea><button id="ephone-watch-send" class="primary">發送</button></div>
      </div></section>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-watch-close]').forEach(x=>x.addEventListener('click',close));
    d.querySelector('#ephone-watch-load').addEventListener('click',loadVideo);
    d.querySelector('#ephone-watch-analyze').addEventListener('click',()=>analyze(true));
    d.querySelector('#ephone-watch-send').addEventListener('click',sendMessage);
    d.querySelector('#ephone-watch-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
    d.querySelector('#ephone-watch-url').addEventListener('keydown',e=>{if(e.key==='Enter')loadVideo();});
    fillChars();
    return d;
  }
  function open(){const d=modal(); fillChars(); refreshAppAppearance(); d.hidden=false; document.body.classList.add('ep-watch-open');}
  function close(){const d=document.getElementById(MODAL_ID); if(!d)return; d.hidden=true; document.body.classList.remove('ep-watch-open'); if(timer){clearInterval(timer);timer=null;}}
  async function loadVideo(){
    const url=document.getElementById('ephone-watch-url').value.trim(); const id=youtubeId(url);
    if(!id){setStatus('請貼有效的公開 YouTube 影片網址。',true);return;}
    currentUrl=url; lastAnalyzed=0; messages=[]; contextCache.clear(); renderChat(); setStatus('正在載入 YouTube 播放器…');
    try{await loadYT();}catch(e){setStatus(e.message,true);return;}
    if(player){try{player.destroy();}catch(_){} player=null;}
    player=new YT.Player(PLAYER_ID,{videoId:id,width:'100%',height:'100%',playerVars:{playsinline:1,rel:0},events:{onReady:()=>{setStatus('影片已載入，可以開始共同觀影。'); updateTime();},onStateChange:updateState,onError:e=>setStatus('YouTube 播放器錯誤：'+e.data,true)}});
    if(timer)clearInterval(timer); timer=setInterval(updateTime,1000);
  }
  function updateState(e){updateTime(); if(e.data===1) setStatus('播放中。AI 會以目前時間附近的片段作分析。');}
  function updateTime(){const el=document.getElementById('ephone-watch-time'); if(!el||!player?.getCurrentTime)return; const t=player.getCurrentTime()||0,d=player.getDuration()||0; el.textContent=`目前 ${fmt(t)} / ${d?fmt(d):'--:--'} · 已讀取片段 ${contextCache.size} 段`;}
  function fmt(x){x=Math.max(0,Math.floor(Number(x)||0));return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;}
  function setStatus(s,error){const el=document.getElementById('ephone-watch-status');if(el){el.textContent=s;el.classList.toggle('error',!!error);}}
  function renderChat(){const box=document.getElementById('ephone-watch-chat');if(!box)return;if(!messages.length){box.innerHTML='<div class="ep-watch-empty">載入影片後，你可以直接在這裡聊天。平常聊天不會呼叫影片 API，提到劇情時才會讀取目前片段。</div>';return;}box.innerHTML=messages.map(m=>`<div class="ep-watch-msg ${m.role==='user'?'user':'assistant'}"><div class="ep-watch-msg-name">${esc(m.role==='user'?'你':m.name||'AI')}</div><div class="ep-watch-msg-bubble">${esc(m.text).replace(/\n/g,'<br>')}</div>${m.meta?`<div class="ep-watch-msg-meta">${esc(m.meta)}</div>`:''}</div>`).join('');box.scrollTop=box.scrollHeight;}
  // 本地、可預測的觀影片段判定，不額外呼叫 AI 做「要不要看影片」分類。
  function likelyPlotQuestion(text){
    const s=String(text||'').trim().toLowerCase();
    if(!s) return false;
    const explicit=[
      '看一下','看看','看這段','看这段','回看','重看','再看','看剛才','看刚才','看前面','看後面','看后面',
      '影片','視頻','视频','電影','电影','劇情','剧情','畫面','画面','台詞','台词','角色','鏡頭','镜头','場景','场景',
      '片段','字幕','配樂','配乐','這一幕','这一幕','這個鏡頭','这个镜头','剛才那段','刚才那段',
      '你有沒有看到','你有没有看到','有沒有注意到','有没有注意到','注意到嗎','注意到了吗','你看到','你看到了','你有看到',
      'what happened','what did','did you see','did you notice','why did','who was','what was','in the video','in this scene'
    ];
    if(explicit.some(k=>s.includes(k))) return true;
    const deictic=/(剛才|刚才|剛剛|刚刚|剛才那個|刚才那个|那個人|那个人|那一幕|那一段|這裡|这里|這段|这段|這個人|这个人|他|她|他們|他们|她們|她们|這人|这人|這個|这个|那個|那个)/i.test(s);
    const question=/(嗎|吗|呢|？|why|what|who|where|when|how|為什麼|为什么|怎麼|怎么|誰|谁|哪裡|哪里|是不是|是否|有沒有|有没有|會不會|会不会|能不能|到底|怎麼回事|怎么回事)/i.test(s);
    if(deictic && question) return true;
    if(/^(他|她|他們|他们|她們|她们).{0,24}(是不是|是否|為什麼|为什么|怎麼|怎么|有沒有|有没有|會不會|会不会|突然|剛才|刚才)/i.test(s)) return true;
    return false;
  }

  function cacheKey(now){return Math.floor(Math.max(0,now)/30);}
  async function sendMessage(){const input=document.getElementById('ephone-watch-input');const text=input?.value.trim();if(!text||busy)return;if(!player||!currentUrl){setStatus('請先載入 YouTube 影片。',true);return;}input.value='';messages.push({role:'user',text});renderChat();const auto=document.getElementById('ephone-watch-auto')?.checked!==false;const shouldWatch=auto&&likelyPlotQuestion(text);if(shouldWatch){setStatus('偵測到你正在指涉影片內容，準備讀取目前片段…');await analyze(false,text);return;}const role=getChat()?.name||'AI 觀影夥伴';messages.push({role:'assistant',name:role,text:'（這句沒有明確提到影片內容，我先陪你看，不額外讀取影片。）',meta:'未呼叫影片 API'});renderChat();}
  async function analyze(manual,userText=''){
    if(busy||!player||!currentUrl)return; const c=cfg(); if(!c.apiKey||!c.proxyUrl||!c.model){setStatus('請先在 API 設定填好反代地址、API Key 與模型。',true);return;}
    const now=player.getCurrentTime?.()||0, start=Math.max(0,Math.floor(now-35)), end=Math.floor(now+35), key=cacheKey(now);
    const cached=contextCache.get(key); if(cached && !manual && userText){ await respondFromContext(cached,userText); return; }
    if(!manual && Math.abs(now-lastAnalyzed)<45)return;
    busy=true; setStatus(`AI 正在讀取 ${fmt(start)}–${fmt(end)}…`);
    const chat=getChat(); const role=chat?.name||'AI 觀影夥伴';
    const roleLock=getRoleLock(chat);
    const worldContext=getWatchWorldContext(chat);
    const relationshipContext=getExistingChatContext(chat);
    const recent=messages.slice(-10).map(m=>`${m.role==='user'?'使用者':role}：${m.text}`).join('\n');
    const prompt=`【現在才是本次任務】\n你正在與使用者共同觀看一支 YouTube 影片。現在播放時間約 ${fmt(now)}。\n\n先理解影片 ${fmt(start)} 到 ${fmt(end)} 的實際視覺與聲音內容，再回答使用者。影片內容是外部事實，不得修改你的角色身份。\n\n${worldContext}${relationshipContext}\n\n【觀影提示】\n${document.getElementById('ephone-watch-prompt')?.value||''}\n\n【最近共同觀影聊天】\n${recent}\n\n【使用者這次說】\n${userText||'請自然評論目前片段。'}\n\n【回答要求】\n- 如果使用者是在問影片內容，先以影片實際內容為依據，再以角色本人的立場、個性和語氣回應。\n- 如果使用者是在表達感受，不要突然變成影評人，像角色本人聊天即可。\n- 不要把影片人物當成自己，也不要替使用者發言。\n- 不要重複整段劇情，只提供和使用者這句話真正相關的部分。\n- 不確定就說不確定，不要補造細節。\n- 输出只要角色正常的聊天回复，不要输出“角色分析”“人设分析”“影片分析报告”等元内容。\n\n再次确认：你是「${role}」。影片不会改变你是谁。`;
    const body={
      systemInstruction:{parts:[{text:roleLock}]},
      contents:[{role:'user',parts:[{fileData:{fileUri:currentUrl,mimeType:'video/*'},videoMetadata:{startOffset:`${start}s`,endOffset:`${end}s`}},{text:prompt}]}],
      generationConfig:{temperature:Number(c.temperature)||0.7}
    };
    try{
      const url=nativeEndpoint();
      const headers={'Content-Type':'application/json','x-goog-api-key':c.apiKey,'Authorization':`Bearer ${c.apiKey}`};
      const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)}); const raw=await r.text();
      if(!r.ok)throw new Error(`中轉站回傳 ${r.status}: ${raw.slice(0,700)}`);
      const data=JSON.parse(raw); const text=(data?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').filter(Boolean).join('\n').trim();
      if(!text)throw new Error('Gemini 回傳內容為空。');
      contextCache.set(key,{start,end,text}); messages.push({role:'assistant',name:role,text,meta:`已讀取影片 ${fmt(start)}–${fmt(end)}`}); renderChat(); await saveWatchMemory({start,end,userText,assistantText:text,videoText:text}); lastAnalyzed=now; updateTime(); setStatus(`AI 已理解 ${fmt(start)}–${fmt(end)}，這段也已寫入角色記憶。`);
    }catch(e){console.error('[EPhone Watch]',e);setStatus(e.message||String(e),true);messages.push({role:'assistant',name:role,text:`影片理解失敗：${e.message||String(e)}`});renderChat();}
    finally{busy=false;}
  }
  async function respondFromContext(cached,userText){
    const c=cfg();if(!c.apiKey||!c.proxyUrl||!c.model){setStatus('請先在 API 設定填好反代地址、API Key 與模型。',true);return;}
    const chat=getChat(),role=chat?.name||'AI 觀影夥伴';busy=true;setStatus('AI 正在根據剛才讀過的片段回應…');
    try{
      const roleLock=getRoleLock(chat);
      const worldContext=getWatchWorldContext(chat);
      const relationshipContext=getExistingChatContext(chat);
      const recent=messages.slice(-10).map(m=>`${m.role==='user'?'使用者':role}：${m.text}`).join('\n');
      const prompt=`【現在才是本次任務】\n你正在和使用者共同觀看影片。你已經讀過影片 ${fmt(cached.start)}–${fmt(cached.end)}。\n\n【已讀取的影片內容】\n${cached.text}\n\n${worldContext}${relationshipContext}\n\n【最近聊天】\n${recent}\n\n【使用者現在說】\n${userText}\n\n【回答要求】\n只根据已读取内容回答，不要假装重新观看影片，也不要补造没有依据的细节。先判断用户是在谈影片还是单纯聊天；如果是谈影片，就用影片事实作为依据，但必须保持「${role}」原本的性格、关系、说话习惯和立场。不要变成影评人，不要替用户发言，不要把影片人物当成自己。输出自然聊天回复，不要输出分析报告或元说明。\n\n最后确认：你是「${role}」，影片不会改变你是谁。`;
      let p=String(c.proxyUrl||'').trim().replace(/\/+$/,'');if(/\/v1$/i.test(p))p=p.slice(0,-3);const model=String(c.model||'').trim();const url=`${p}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body={systemInstruction:{parts:[{text:roleLock}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:Number(c.temperature)||0.7}};
      const headers={'Content-Type':'application/json','x-goog-api-key':c.apiKey,'Authorization':`Bearer ${c.apiKey}`};const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const raw=await r.text();if(!r.ok)throw new Error(`中轉站回傳 ${r.status}: ${raw.slice(0,700)}`);const data=JSON.parse(raw);const text=(data?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').filter(Boolean).join('\n').trim();if(!text)throw new Error('Gemini 回傳內容為空。');
      messages.push({role:'assistant',name:role,text,meta:`沿用已讀取片段 ${fmt(cached.start)}–${fmt(cached.end)}，未重新送影片`}); await saveWatchMemory({start:cached.start,end:cached.end,userText,assistantText:text,videoText:cached.text}); renderChat();setStatus('AI 已根據已讀片段回應，這次談論也已寫入角色記憶。');
    }catch(e){console.error('[EPhone Watch cached]',e);setStatus(e.message||String(e),true);messages.push({role:'assistant',name:role,text:`回應失敗：${e.message||String(e)}`});renderChat();}
    finally{busy=false;}
  }
  window.EPhoneWatch={open,close,analyze,loadVideo,refreshAppAppearance};
  
  function installButton(){
    const host=document.querySelector('.ephone-third-apps'); if(!host||document.getElementById('ephone-watch-app'))return;
    const b=document.createElement('button'); b.id='ephone-watch-app'; b.className='ephone-third-app'; b.type='button'; b.addEventListener('click',open); host.appendChild(b); refreshAppAppearance();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installButton);else installButton();
  setTimeout(installButton,1000);
})();
