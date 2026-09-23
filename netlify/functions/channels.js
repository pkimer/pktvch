const fallbackData = require("../../channels.json");

const ROOT = "https://webtv.dothome.co.kr/";
const REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 (SmartTV; WebTV Netlify Function)",
  accept: "text/html,application/json,text/plain,*/*"
};

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeShortUrl(url) {
  return url.replace(/(https:\/\/xzx\.kr\/)\/{2,}/i, "$1");
}

function category(number) {
  if (number <= 18) return "지상파·종편·뉴스";
  if (number <= 43) return "예능·뉴스·엔터테인먼트";
  if (number <= 73) return "스포츠·레저";
  if (number <= 103) return "교육·키즈·교양";
  if (number <= 133) return "종교·지역·공공·경제";
  if (number <= 150) return "홈쇼핑";
  return "해외·글로벌";
}

function parseChannelScripts(sources) {
  const channels = [];
  const anchorPattern = /<a[^>]+onclick="(.*?)"[^>]*>(.*?)<\/a>/gis;
  for (const source of sources) {
    let match;
    while ((match = anchorPattern.exec(decodeURIComponentSafe(source)))) {
      const click = match[1].replace(/\\'/g, "'").trim();
      const name = match[2].replace(/<[^>]+>/g, "").trim();
      if (!name || (!click.includes("window.open") && !click.startsWith("pop"))) continue;
      const number = channels.length + 1;
      const item = { id:`ch-${String(number).padStart(3,"0")}`, name, number, category:category(number), source_page:ROOT };
      const direct = click.match(/window\.open\(['"]([^'"]+)/i);
      if (direct) {
        const url = normalizeShortUrl(direct[1]);
        if (/\.m3u8(?:$|\?)/i.test(url)) item.playback_url = url;
        else item.page_url = url;
      } else {
        const action = click.match(/(pop\w+)\(['"]?(.*?)['"]?\);/i);
        item.source_url = ROOT;
        item.source_action = action ? `${action[1]}${action[2] ? `:${action[2]}` : ""}` : click;
      }
      channels.push(item);
    }
  }
  return channels;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

async function resolveDynamic(item) {
  const action = item.source_action || "";
  try {
    if (item.name === "SBS뉴스") {
      return {
        ...item,
        page_url:"https://www.youtube.com/embed/live_stream?channel=UCkinYTS9IHqOEwR1Sze2JTw&autoplay=1&playsinline=1&rel=0",
        resolved_from:"SBS News official YouTube live channel",
        source_url:undefined,
        source_action:undefined
      };
    }
    if (item.name === "서울방송" || item.page_url === "https://xzx.kr/kkz") {
      return {
        ...item,
        playback_url:"https://tistory1.daumcdn.net/tistory/2864460/skin/images/CATV_2_76142D8F1.m3u8",
        page_url:undefined,
        resolved_from:"SBS source redirect",
        source_url:undefined,
        source_action:undefined
      };
    }
    if (action.startsWith("popKBS:")) {
      const code = encodeURIComponent(action.slice("popKBS:".length));
      const data = JSON.parse(await fetchText(`https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/${code}`));
      const url = data?.channel_item?.[0]?.service_url;
      if (url) return { ...item, playback_url:url, resolved_from:"KBS live API", source_url:undefined, source_action:undefined };
    }
    if (action === "popKBSNews") {
      const data = JSON.parse(await fetchText("https://api.tv.naver.com/api/open/live/v2/player/playback?liveId=18333419&countryCode=KR&timeMachine=true"));
      const url = data?.media?.[0]?.path;
      if (url) return { ...item, playback_url:url, resolved_from:"Naver TV live API", source_url:undefined, source_action:undefined };
    }
    if (action === "popMBN") {
      const url = (await fetchText("https://www.mbn.co.kr/player/mbnStreamAuth_new_live.mbn?vod_url=https://hls-live.mbn.co.kr/mbn-on-air/600k/playlist.m3u8")).trim();
      if (/^https?:\/\//i.test(url)) return { ...item, playback_url:url, resolved_from:"MBN stream authorization", source_url:undefined, source_action:undefined };
    }
  } catch (error) {
    return { ...item, resolve_error:error.name === "AbortError" ? "timeout" : "unavailable" };
  }
  return item;
}

async function buildLiveChannels() {
  const home = await fetchText(ROOT);
  const decoded = decodeURIComponentSafe(home);
  const scriptUrls = [...new Set(decoded.match(/https:\/\/[^"<> ]+?\/webtv_tv_[^"<> ]+?\.js/g) || [])];
  if (!scriptUrls.length) throw new Error("Channel scripts were not found");
  const sources = await Promise.all(scriptUrls.map(url => fetchText(url)));
  const parsed = parseChannelScripts(sources);
  if (parsed.length < 100) throw new Error(`Only ${parsed.length} channels parsed`);
  return Promise.all(parsed.map(resolveDynamic));
}

async function findLatestChannel(query) {
  const home = await fetchText(ROOT);
  const decoded = decodeURIComponentSafe(home);
  const scriptUrls = [...new Set(decoded.match(/https:\/\/[^"<> ]+?\/webtv_tv_[^"<> ]+?\.js/g) || [])];
  if (!scriptUrls.length) throw new Error("Channel scripts were not found");
  const sources = await Promise.all(scriptUrls.map(url => fetchText(url)));
  const parsed = parseChannelScripts(sources);
  const number = Number(query.number);
  const found = parsed.find(item => query.id && item.id === query.id)
    || parsed.find(item => Number.isFinite(number) && item.number === number && (!query.name || item.name === query.name))
    || parsed.find(item => query.name && item.name === query.name);
  if (!found) throw new Error("Channel was not found in the current source list");
  return resolveDynamic(found);
}

exports.handler = async function (event = {}) {
  const query = event.queryStringParameters || {};
  if (query.resolve === "1") {
    try {
      const channel = await findLatestChannel(query);
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120"
        },
        body: JSON.stringify({ resolved_at:new Date().toISOString(), source:ROOT, channel })
      };
    } catch (error) {
      return {
        statusCode: 502,
        headers: { "content-type":"application/json; charset=utf-8", "access-control-allow-origin":"*", "cache-control":"no-store" },
        body: JSON.stringify({ error:"최신 채널 주소를 확인하지 못했습니다.", detail:error.name === "AbortError" ? "timeout" : error.message })
      };
    }
  }
  let channels;
  let live = true;
  let warning;
  try {
    channels = await buildLiveChannels();
  } catch (error) {
    channels = await Promise.all(fallbackData.channels.map(resolveDynamic));
    live = false;
    warning = "원본 사이트 갱신에 실패하여 배포 시 포함된 채널 목록을 반환했습니다.";
  }
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
    },
    body: JSON.stringify({
      schema_version: 2,
      generated_at: new Date().toISOString(),
      source: ROOT,
      live,
      ...(warning ? { warning } : {}),
      channels
    })
  };
};
