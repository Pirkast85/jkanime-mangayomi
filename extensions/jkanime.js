const mangayomiSources = [{
  name: "JKAnime",
  lang: "es",
  baseUrl: "https://jkanime.net",
  apiUrl: "",
  iconUrl: "https://cdn.jkanime.net/logo_jk.png",
  typeSource: "single",
  itemType: 1,
  version: "0.3.0",
  dateFormat: "",
  dateFormatLocale: "",
  pkgPath: "anime/src/es/jkanime.js"
}];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  statusFromString(status) {
    return {
      "En emision": 0,
      "Finalizado": 1,
      "Concluido": 1,
      "Concluido ": 1
    }[status] ?? 5;
  }

  async parseAnimeList(url) {
    const res = await this.client.get(url);
    const doc = new Document(res.body);
    const list = [];

    // JKAnime exposes catalogue data in an inline `var animes` script.
    // Older extensions attempted JSON.parse() on a regex fragment. That
    // fragment can contain nested data and is no longer guaranteed to be a
    // complete JSON object, which caused: SyntaxError: expecting ']'.
    const script = doc.selectFirst("script:contains(var animes)");
    const code = script ? script.text : "";

    // Parse only the fields we need instead of JSON.parse() on the fragment.
    for (const m of code.matchAll(/\"title\"\s*:\s*\"((?:\\.|[^\"])*)\"[\s\S]*?\"image\"\s*:\s*\"((?:\\.|[^\"])*)\"[\s\S]*?\"slug\"\s*:\s*\"((?:\\.|[^\"])*)\"/g)) {
      const name = m[1].replace(/\\\"/g, '"');
      const imageUrl = m[2].replace(/\\\//g, "/").replace(/\\\"/g, '"');
      const slug = m[3].replace(/\\\//g, "/");
      list.push({
        name: name,
        imageUrl: imageUrl,
        link: `${this.source.baseUrl}/${slug}`
      });
    }

    // DOM fallback for layouts where the inline catalogue is absent.
    if (!list.length) {
      for (const e of doc.select("div.portada-box, div#conb")) {
        const a = e.selectFirst("h2 a") || e.selectFirst("a");
        const img = e.selectFirst("img");
        if (!a) continue;
        const href = a.attr("href") || a.getHref || "";
        const title = (a.attr("title") || a.text || "").trim();
        const image = img ? (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || img.getSrc || "") : "";
        if (title && href) {
          list.push({
            name: title,
            imageUrl: href.startsWith("http") ? image : image,
            link: href.startsWith("http") ? href : `${this.source.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`
          });
        }
      }
    }

    const nextBtn = doc.selectFirst("a.nav-next");
    const hasNextPage = !!(nextBtn && nextBtn.text && nextBtn.text.trim() !== "");
    return { list, hasNextPage };
  }

  async getPopular(page) {
    const res = await this.client.get(`${this.source.baseUrl}/top/`);
    const doc = new Document(res.body);
    const list = [];

    for (const e of doc.select("div#conb")) {
      const a = e.selectFirst("h2 a") || e.selectFirst("a");
      const img = e.selectFirst("img");
      if (!a) continue;
      let link = a.attr("href") || a.getHref || "";
      if (link.endsWith("/")) link = link.slice(0, -1);
      list.push({
        name: (a.text || "").trim(),
        imageUrl: img ? (img.attr("data-src") || img.attr("src") || img.getSrc || "") : "",
        link: link
      });
    }

    return { list, hasNextPage: false };
  }

  async getLatestUpdates(page) {
    return await this.parseAnimeList(`${this.source.baseUrl}/directorio/${page}/`);
  }

  async search(query, page, filters) {
    query = query.trim().replaceAll(/\ +/g, "_");

    if (!filters || filters.length === 0) {
      return await this.parseAnimeList(`${this.source.baseUrl}/buscar/${query}/${page}/`);
    }

    if (query) {
      let url = `${this.source.baseUrl}/buscar/${query}/${page}/`;
      if (filters[1]) url += `?filtro=${filters[1].values[filters[1].state].value}`;
      if (filters[5]) url += `&tipo=${filters[5].values[filters[5].state].value}`;
      if (filters[6]) url += `&estado=${filters[6].values[filters[6].state].value}`;
      return await this.parseAnimeList(url);
    }

    let url = `${this.source.baseUrl}/directorio/${page}`;
    for (let i = 1; i <= 8; i++) {
      if (filters[i]) url += `/${filters[i].values[filters[i].state].value}`;
    }
    return await this.parseAnimeList(url);
  }

  async getDetail(url) {
    const res = await this.client.get(url);
    const doc = new Document(res.body);
    const detail = {};

    const idMatch = res.body.match(/data-anime="(\d+)"/);
    const info = doc.selectFirst("div.anime__details__content");
    const extInfo = doc.selectFirst("div.aninfo");

    if (info) {
      detail.name = info.selectFirst("h3")?.text || "";
      detail.imageUrl = info.selectFirst("div.anime__details__pic")?.attr("data-setbg") || "";
      detail.description = (info.selectFirst("p.sinopsis")?.text || "").trim();
    }

    if (extInfo) {
      const statusEl = extInfo.selectFirst("span:contains(Estado) + span");
      detail.status = this.statusFromString(statusEl ? statusEl.text : "");
      detail.genre = extInfo.select("li:contains(Genero) a").map(e => e.text);
      detail.author = extInfo.select("li:contains(Studios) a").map(e => e.text).join(", ");
    } else {
      detail.status = 5;
      detail.genre = [];
      detail.author = "";
    }

    detail.episodes = [];

    if (idMatch) {
      try {
        const last = await this.client.get(`${this.source.baseUrl}/ajax/last_episode/${idMatch[1]}`, {"User-Agent": "Mangayomi"});
        const parsed = JSON.parse(last.body);
        const end = parsed && parsed[0] ? parseInt(parsed[0].number) : 0;
        for (let i = 1; i <= end; i++) {
          detail.episodes.push({ name: `Episodio ${i}`, url: `${url.replace(/\/$/, "")}/${i}` });
        }
        detail.episodes.reverse();
      } catch (_) {
        // Episode API can be temporarily unavailable. Keep the detail page usable.
      }
    }

    return detail;
  }

  async extractRedirect(redirect, referer, lang, type, host) {
    try {
      const res = await this.client.get(this.source.baseUrl + redirect, {"Referer": referer});
      const match = res.body.match(/https?:\/\/[^\"'\s]+?\.m3u8[^\"'\s]*/i);
      if (!match) return [];
      return [{
        url: match[0],
        originalUrl: match[0],
        headers: {"Referer": referer},
        quality: `${lang} ${type} ${host}`
      }];
    } catch (_) {
      return [];
    }
  }

  async getVideoList(url) {
    const res = await this.client.get(url);
    const doc = new Document(res.body);
    const videos = [];
    const codeEl = doc.selectFirst("script:contains(var video)");
    const code = codeEl ? codeEl.text : "";

    // Current JKAnime exposes Desu as a redirect to an m3u8 playlist.
    for (const m of code.matchAll(/video\s*\[\d+\].*?src="(.*?)"/g)) {
      const found = await this.extractRedirect(m[1], url, "Español", "Sub", "Desu");
      videos.push(...found);
    }

    // Some servers are exposed as base64 encoded remote URLs. Resolve only
    // servers for which the URL itself is already a playable media resource.
    for (const m of code.matchAll(/\{"remote"\s*:\s*"(.*?)".*?"server"\s*:\s*"(.*?)"/g)) {
      try {
        const link = Uint8Array.fromBase64(m[1]).decode("utf-8");
        const host = m[2];
        if (/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(link)) {
          videos.push({url: link, originalUrl: link, quality: `Español Sub ${host}`});
        }
      } catch (_) {}
    }

    // Generic iframe/source fallback.
    if (!videos.length) {
      for (const el of doc.select("iframe, video, source")) {
        const src = el.attr("src") || el.attr("data-src") || el.attr("data-url") || "";
        if (!src) continue;
        if (/\.(m3u8|mp4)(?:\?|$)/i.test(src)) {
          videos.push({url: src, originalUrl: src, quality: "JKAnime"});
        }
      }
    }

    return videos;
  }

  getFilterList() {
    return [];
  }
}
