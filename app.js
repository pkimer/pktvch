(function () {
  "use strict";
  var cfg = window.TV_APP_CONFIG || {};
  var state = { channels: [], filtered: [], category: "전체", numeric: "", numericTimer: null, lastFocus: null, unlocked: false, pinInput: "", openToken: 0 };
  var pinGate = document.getElementById("pin-gate");
  var pinDots = document.getElementById("pin-dots");
  var pinMessage = document.getElementById("pin-message");
  var grid = document.getElementById("channel-grid");
  var categories = document.getElementById("categories");
  var statusEl = document.getElementById("status");
  var guide = document.getElementById("guide");
  var playerView = document.getElementById("player-view");
  var video = document.getElementById("video");
  var frame = document.getElementById("web-player");
  var message = document.getElementById("player-message");
  var overlay = document.getElementById("number-overlay");

  function channelUrl() {
    var override = new URLSearchParams(location.search).get("channels");
    return override || cfg.CHANNELS_URL || "./channels.json";
  }

  function renderPin() {
    [].slice.call(pinDots.children).forEach(function(dot,index){dot.classList.toggle("filled",index<state.pinInput.length);});
  }

  function unlock() {
    if (state.pinInput === String(cfg.ACCESS_PIN || "1213")) {
      state.unlocked=true; pinGate.classList.add("unlocked"); pinGate.setAttribute("aria-hidden","true");
      var first=grid.querySelector(".focusable"); if(first) first.focus();
    } else {
      pinMessage.textContent="암호가 올바르지 않습니다. 다시 입력하세요."; pinMessage.classList.add("error");
      state.pinInput=""; renderPin();
    }
  }

  function enterPinDigit(digit) {
    if(state.pinInput.length>=4)return;
    pinMessage.textContent="숫자키 0–9 · Back 지우기"; pinMessage.classList.remove("error");
    state.pinInput+=digit; renderPin(); if(state.pinInput.length===4)setTimeout(unlock,120);
  }

  function escapeHtml(value) { var d=document.createElement("div"); d.textContent=value == null ? "" : String(value); return d.innerHTML; }
  function typeLabel(ch) { return ch.playback_url ? "LIVE" : ch.page_url ? "WEB" : "SOURCE"; }

  function fetchJson(url) {
    var controller=window.AbortController?new AbortController():null;
    var timer=setTimeout(function(){if(controller)controller.abort();},cfg.REQUEST_TIMEOUT_MS||12000);
    return fetch(url,{cache:"no-store",signal:controller?controller.signal:undefined}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).finally(function(){clearTimeout(timer);});
  }

  function resolveDynamicChannel(ch) {
    var action=ch.source_action||"";
    if(action.indexOf("popKBS:")===0){
      var code=encodeURIComponent(action.slice(7));
      return fetchJson("https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/"+code).then(function(data){var url=data&&data.channel_item&&data.channel_item[0]&&data.channel_item[0].service_url;if(url){ch.playback_url=url;delete ch.source_url;delete ch.source_action;}return ch;}).catch(function(){return ch;});
    }
    if(action==="popKBSNews"){
      return fetchJson("https://api.tv.naver.com/api/open/live/v2/player/playback?liveId=18333419&countryCode=KR&timeMachine=true").then(function(data){var url=data&&data.media&&data.media[0]&&data.media[0].path;if(url){ch.playback_url=url;delete ch.source_url;delete ch.source_action;}return ch;}).catch(function(){return ch;});
    }
    if(action==="popMBN"){
      return fetch("https://www.mbn.co.kr/player/mbnStreamAuth_new_live.mbn?vod_url=https://hls-live.mbn.co.kr/mbn-on-air/600k/playlist.m3u8",{cache:"no-store"}).then(function(r){return r.text();}).then(function(url){url=url.trim();if(/^https?:\/\//i.test(url)){ch.playback_url=url;delete ch.source_url;delete ch.source_action;}return ch;}).catch(function(){return ch;});
    }
    return Promise.resolve(ch);
  }

  function latestChannel(ch) {
    var base=channelUrl();
    if(base.indexOf("/.netlify/functions/channels")<0) return resolveDynamicChannel(Object.assign({},ch));
    var join=base.indexOf("?")>=0?"&":"?";
    var url=base+join+"resolve=1&id="+encodeURIComponent(ch.id||"")+"&number="+encodeURIComponent(ch.number||"")+"&name="+encodeURIComponent(ch.name||"");
    return fetchJson(url).then(function(data){
      var latest=data&&data.channel?data.channel:ch;
      if(!latest.playback_url&&!latest.page_url&&latest.source_action) return resolveDynamicChannel(latest);
      return latest;
    });
  }

  function renderCategories() {
    var values = ["전체"];
    state.channels.forEach(function (ch) { if (values.indexOf(ch.category) < 0) values.push(ch.category); });
    categories.innerHTML = values.map(function (name) {
      return '<button class="category focusable'+(name===state.category?' active':'')+'" data-category="'+escapeHtml(name)+'">'+escapeHtml(name)+'</button>';
    }).join("");
  }

  function renderGrid() {
    state.filtered = state.category === "전체" ? state.channels : state.channels.filter(function (c) { return c.category === state.category; });
    grid.innerHTML = state.filtered.map(function (ch) {
      return '<button class="channel-card focusable" data-id="'+escapeHtml(ch.id)+'"><span class="number">CH '+String(ch.number).padStart(3,"0")+'</span><span class="name">'+escapeHtml(ch.name)+'</span><span class="type">'+typeLabel(ch)+'</span></button>';
    }).join("");
    statusEl.textContent = state.filtered.length + "개 채널";
  }

  function loadChannels() {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function(){ if(controller) controller.abort(); }, cfg.REQUEST_TIMEOUT_MS || 12000);
    fetch(channelUrl(), { cache:"no-store", signal:controller ? controller.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function (data) {
        state.channels = Array.isArray(data) ? data : data.channels || [];
        return Promise.all(state.channels.map(resolveDynamicChannel)).then(function(resolved){state.channels=resolved;return data;});
      })
      .then(function (data) {
        state.channels.sort(function(a,b){ return Number(a.number)-Number(b.number); });
        renderCategories(); renderGrid();
        var unresolved=state.channels.filter(function(ch){return ch.source_action;}).length;
        if(unresolved){statusEl.className="status error";statusEl.textContent=state.filtered.length+"개 채널 · 동적 주소 "+unresolved+"개 갱신 실패";}
        var first = grid.querySelector(".focusable"); if (first) first.focus();
      })
      .catch(function (err) { statusEl.className="status error"; statusEl.textContent="채널 목록을 불러오지 못했습니다. config.js의 주소와 Netlify CORS 설정을 확인하세요. ("+err.message+")"; })
      .finally(function(){ clearTimeout(timer); });
  }

  function showChannel(ch) {
    video.className=""; frame.className=""; message.className="player-message";
    video.pause(); video.removeAttribute("src"); video.load(); frame.src="about:blank";
    if (ch.playback_url) {
      video.className="active"; video.src=ch.playback_url;
      var promise=video.play(); if(promise&&promise.catch) promise.catch(function(){ message.className="player-message active"; message.textContent="재생을 시작하려면 Enter를 눌러 주세요."; });
    } else if (ch.page_url) {
      frame.className="active"; frame.src=ch.page_url;
    } else {
      message.className="player-message active";
      message.textContent="최신 주소를 확인했지만 TV에서 직접 재생할 수 있는 주소를 찾지 못했습니다.";
    }
  }

  function openChannel(ch) {
    if (!ch) return;
    var token=++state.openToken;
    state.lastFocus = document.activeElement;
    document.getElementById("now-number").textContent = "CH "+String(ch.number).padStart(3,"0");
    document.getElementById("now-name").textContent = ch.name;
    guide.style.display="none"; playerView.classList.add("active"); playerView.setAttribute("aria-hidden","false");
    if (!history.state || history.state.view !== "player") {
      history.pushState({ view:"player", channelId:ch.id }, "", "#channel-"+encodeURIComponent(ch.id));
    }
    video.className=""; frame.className=""; message.className="player-message active";
    video.pause(); video.removeAttribute("src"); video.load(); frame.src="about:blank";
    message.textContent="원본 사이트에서 최신 채널 주소를 확인하고 있습니다…";
    latestChannel(ch).then(function(latest){if(token!==state.openToken||!playerView.classList.contains("active"))return;showChannel(latest);}).catch(function(){if(token!==state.openToken||!playerView.classList.contains("active"))return;message.textContent="최신 주소 조회에 실패하여 저장된 주소로 재생합니다.";setTimeout(function(){if(token===state.openToken)showChannel(ch);},700);});
  }

  function closePlayer(fromHistory) {
    if (!playerView.classList.contains("active")) return false;
    state.openToken++;
    if (!fromHistory && history.state && history.state.view === "player") {
      history.back();
      return true;
    }
    video.pause(); video.removeAttribute("src"); video.load(); frame.src="about:blank";
    playerView.classList.remove("active"); playerView.setAttribute("aria-hidden","true"); guide.style.display="block";
    if(state.lastFocus && document.body.contains(state.lastFocus)) state.lastFocus.focus();
    return true;
  }

  function moveFocus(direction) {
    var items=[].slice.call(document.querySelectorAll(".focusable:not([disabled])")).filter(function(x){return x.offsetParent!==null;});
    var current=document.activeElement, r=current&&current.getBoundingClientRect();
    if (!r || items.indexOf(current)<0) { if(items[0]) items[0].focus(); return; }
    var cx=r.left+r.width/2, cy=r.top+r.height/2, best=null, bestScore=Infinity;
    items.forEach(function(el){ if(el===current)return; var q=el.getBoundingClientRect(), x=q.left+q.width/2, y=q.top+q.height/2, dx=x-cx, dy=y-cy;
      var valid=(direction==="left"&&dx<0)||(direction==="right"&&dx>0)||(direction==="up"&&dy<0)||(direction==="down"&&dy>0); if(!valid)return;
      var primary=(direction==="left"||direction==="right")?Math.abs(dx):Math.abs(dy); var secondary=(direction==="left"||direction==="right")?Math.abs(dy):Math.abs(dx); var score=primary+secondary*2.4;
      if(score<bestScore){bestScore=score;best=el;}
    });
    if(best){best.focus();best.scrollIntoView({block:"nearest",inline:"nearest"});}
  }

  function numericInput(digit) {
    state.numeric=(state.numeric+digit).slice(-3); overlay.textContent=state.numeric; overlay.classList.add("active"); clearTimeout(state.numericTimer);
    state.numericTimer=setTimeout(function(){ var n=parseInt(state.numeric,10), ch=state.channels.find(function(c){return Number(c.number)===n;}); overlay.classList.remove("active"); state.numeric=""; if(ch)openChannel(ch); }, cfg.NUMBER_INPUT_DELAY_MS || 1300);
  }

  document.addEventListener("click",function(e){ var pin=e.target.closest("[data-pin]"); if(pin&&!state.unlocked){enterPinDigit(pin.dataset.pin);return;} if(e.target.closest("[data-pin-clear]")&&!state.unlocked){state.pinInput="";renderPin();return;} if(e.target.closest("[data-pin-enter]")&&!state.unlocked){unlock();return;} var cat=e.target.closest("[data-category]"); if(cat){state.category=cat.dataset.category;renderCategories();renderGrid();grid.querySelector(".focusable")?.focus();return;} var card=e.target.closest("[data-id]"); if(card)openChannel(state.channels.find(function(c){return c.id===card.dataset.id;})); });
  document.addEventListener("keydown",function(e){ var key=e.key, code=e.keyCode;
    if(!state.unlocked){
      if((key>="0"&&key<="9")||(code>=48&&code<=57)||(code>=96&&code<=105)){enterPinDigit(key>="0"&&key<="9"?key:String(code>=96?code-96:code-48));e.preventDefault();return;}
      if(key==="Backspace"||key==="Escape"||code===10009){state.pinInput=state.pinInput.slice(0,-1);renderPin();e.preventDefault();return;}
      if(key==="Enter"||code===13){unlock();e.preventDefault();return;}
      return;
    }
    if ((key>="0"&&key<="9") || (code>=48&&code<=57) || (code>=96&&code<=105)) { numericInput(key>="0"&&key<="9"?key:String(code>=96?code-96:code-48)); e.preventDefault(); return; }
    if(key==="Backspace"||key==="Escape"||code===10009){ if(closePlayer())e.preventDefault(); return; }
    if(playerView.classList.contains("active")){ if(key==="Enter"&&video.classList.contains("active")){video.paused?video.play():video.pause();e.preventDefault();} return; }
    var map={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"}; if(map[key]){moveFocus(map[key]);e.preventDefault();}
    if(key==="Enter"||code===13){var card=document.activeElement.closest&&document.activeElement.closest("[data-id]");if(card){openChannel(state.channels.find(function(c){return c.id===card.dataset.id;}));e.preventDefault();}}
  });
  if (!history.state || history.state.view !== "list") history.replaceState({view:"list"},"",location.pathname+location.search);
  window.addEventListener("popstate",function(){closePlayer(true);});
  function tick(){document.getElementById("clock").textContent=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});} tick();setInterval(tick,30000);
  if("serviceWorker" in navigator) window.addEventListener("load",function(){navigator.serviceWorker.register("./sw.js").catch(function(){});});
  loadChannels();
})();
