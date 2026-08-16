const mangayomiSources = [{
  name: "JKAnime Comunidad",
  lang: "es",
  baseUrl: "https://jkanime.net",
  apiUrl: "",
  iconUrl: "https://cdn.jkanime.net/logo_jk.png",
  typeSource: "single",
  itemType: 1,
  id: 9000000102,
  version: "0.4.0",
  dateFormat: "",
  dateFormatLocale: "",
  pkgPath: "anime/src/es/jkanime.js"
}];

class DefaultExtension extends MProvider {
  constructor() { super(); this.client = new Client(); }
  statusFromString(status) { return {"En emision":0,"Finalizado":1,"Concluido":1,"Concluido ":1}[status] ?? 5; }

  async parseAnimeList(url) {
    const res = await this.client.get(url);
    const doc = new Document(res.body);
    const list = [];
    const script = doc.selectFirst("script:contains(var animes)");
    const code = script ? script.text : "";

    // Never JSON.parse() a regex fragment: JKAnime's catalogue objects can
    // contain nested arrays/objects and that caused "expecting ]" errors.
    for (const m of code.matchAll(/\"title\"\s*:\s*\"((?:\\.|[^\"])*)\"[\s\S]*?\"image\"\s*:\s*\"((?:\\.|[^\"])*)\"[\s\S]*?\"slug\"\s*:\s*\"((?:\\.|[^\"])*)\"/g)) {
      const name = m[1].replace(/\\\"/g,'"');
      const imageUrl = m[2].replace(/\\\//g,"/").replace(/\\\"/g,'"');
      const slug = m[3].replace(/\\\//g,"/");
      list.push({name,imageUrl,link:`${this.source.baseUrl}/${slug}`});
    }

    // HTML fallback for catalogue layouts without the inline variable.
    if (!list.length) {
      for (const e of doc.select("div.portada-box, div#conb")) {
        const a=e.selectFirst("h2 a")||e.selectFirst("a"), img=e.selectFirst("img");
        if(!a) continue;
        let link=a.attr("href")||a.getHref||"";
        if(!link) continue;
        if(!link.startsWith("http")) link=`${this.source.baseUrl}${link.startsWith("/")?"":"/"}${link}`;
        const name=(a.attr("title")||a.text||"").trim();
        const imageUrl=img?(img.attr("data-src")||img.attr("data-lazy-src")||img.attr("src")||img.getSrc||""):"";
        if(name) list.push({name,imageUrl,link});
      }
    }
    const nextBtn=doc.selectFirst("a.nav-next");
    return {list,hasNextPage:!!(nextBtn&&nextBtn.text&&nextBtn.text.trim()!=="")};
  }

  async getPopular(page) {
    const res=await this.client.get(`${this.source.baseUrl}/top/`),doc=new Document(res.body),list=[];
    for(const e of doc.select("div#conb")){
      const a=e.selectFirst("h2 a")||e.selectFirst("a"),img=e.selectFirst("img");
      if(!a)continue;
      let link=a.attr("href")||a.getHref||""; if(link.endsWith("/"))link=link.slice(0,-1);
      list.push({name:(a.text||"").trim(),imageUrl:img?(img.attr("data-src")||img.attr("src")||img.getSrc||""):"",link});
    }
    return {list,hasNextPage:false};
  }

  async getLatestUpdates(page){return await this.parseAnimeList(`${this.source.baseUrl}/directorio/${page}/`);}

  async search(query,page,filters){
    query=query.trim().replaceAll(/\ +/g,"_");
    if(!filters||filters.length===0)return await this.parseAnimeList(`${this.source.baseUrl}/buscar/${query}/${page}/`);
    if(query){
      let u=`${this.source.baseUrl}/buscar/${query}/${page}/`;
      if(filters[1])u+=`?filtro=${filters[1].values[filters[1].state].value}`;
      if(filters[5])u+=`&tipo=${filters[5].values[filters[5].state].value}`;
      if(filters[6])u+=`&estado=${filters[6].values[filters[6].state].value}`;
      return await this.parseAnimeList(u);
    }
    let u=`${this.source.baseUrl}/directorio/${page}`;
    for(let i=1;i<=8;i++)if(filters[i])u+=`/${filters[i].values[filters[i].state].value}`;
    return await this.parseAnimeList(u);
  }

  async getDetail(url){
    const res=await this.client.get(url),doc=new Document(res.body),detail={};
    const idMatch=res.body.match(/data-anime="(\d+)"/),info=doc.selectFirst("div.anime__details__content"),ext=doc.selectFirst("div.aninfo");
    detail.name=info?.selectFirst("h3")?.text||"";
    detail.imageUrl=info?.selectFirst("div.anime__details__pic")?.attr("data-setbg")||"";
    detail.description=(info?.selectFirst("p.sinopsis")?.text||"").trim();
    detail.status=this.statusFromString(ext?.selectFirst("span:contains(Estado) + span")?.text||"");
    detail.genre=ext?ext.select("li:contains(Genero) a").map(e=>e.text):[];
    detail.author=ext?ext.select("li:contains(Studios) a").map(e=>e.text).join(", "):"";
    detail.episodes=[];
    if(idMatch)try{
      const r=await this.client.get(`${this.source.baseUrl}/ajax/last_episode/${idMatch[1]}`,{"User-Agent":"Mangayomi"});
      const a=JSON.parse(r.body),end=a&&a[0]?parseInt(a[0].number):0;
      for(let i=1;i<=end;i++)detail.episodes.push({name:`Episodio ${i}`,url:`${url.replace(/\/$/,"")}/${i}`});
      detail.episodes.reverse();
    }catch(_){ }
    return detail;
  }

  async extractRedirect(redirect,referer,lang,type,host){
    try{
      const r=await this.client.get(this.source.baseUrl+redirect,{"Referer":referer});
      const m=r.body.match(/https?:\/\/[^\"'\s]+?\.m3u8[^\"'\s]*/i);
      return m?[{url:m[0],originalUrl:m[0],headers:{"Referer":referer},quality:`${lang} ${type} ${host}`}]:[];
    }catch(_){return[];}
  }

  async getVideoList(url){
    const res=await this.client.get(url),doc=new Document(res.body),videos=[];
    const el=doc.selectFirst("script:contains(var video)"),code=el?el.text:"";
    for(const m of code.matchAll(/video\s*\[\d+\].*?src="(.*?)"/g))videos.push(...await this.extractRedirect(m[1],url,"Español","Sub","Desu"));
    for(const m of code.matchAll(/\{"remote"\s*:\s*"(.*?)".*?"server"\s*:\s*"(.*?)"/g))try{
      const link=Uint8Array.fromBase64(m[1]).decode("utf-8"),host=m[2];
      if(/\.(m3u8|mp4)(?:\?|$)/i.test(link))videos.push({url:link,originalUrl:link,quality:`Español Sub ${host}`});
    }catch(_){ }
    if(!videos.length)for(const e of doc.select("iframe,video,source")){
      const src=e.attr("src")||e.attr("data-src")||e.attr("data-url")||"";
      if(/\.(m3u8|mp4)(?:\?|$)/i.test(src))videos.push({url:src,originalUrl:src,quality:"JKAnime"});
    }
    return videos;
  }

  getFilterList(){return[];}
}
