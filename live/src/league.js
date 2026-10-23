/* League store: the shared state of a multiplayer Career league.
   The state is a bag of small named entities (a team, a player, a week of the schedule...). Every write bumps a version, every entity
   remembers the version it was last written at, so a phone can ask "what changed since version N" and send a patch that is refused (with
   the other side's copy) if someone else touched the same entity first. Plain logic over a tiny storage adapter, so the Durable Object and
   the local test server share it. */
export class LeagueCore {
  constructor(store){ this.s = store; this.meta = null; this.idx = null; }
  async load(){
    if (this.meta !== null) return;
    this.meta = (await this.s.get("meta")) || false;
    this.idx = (await this.s.get("idx")) || {};
  }
  async saveMeta(){ await this.s.put("meta", this.meta); }
  ok(o){ return Object.assign({ok: true}, o || {}); }
  no(msg, o){ return Object.assign({ok: false, error: msg}, o || {}); }
  pub(){ const m = this.meta; return {id: m.id, name: m.name, code: m.code, creator: m.creator, status: m.status, members: m.members, ver: m.ver, qlen: m.qlen, created: m.created, waiting: m.waiting || {}, wk: m.wk || null, season: m.season || 0}; }
  async handle(req){
    await this.load();
    const op = req.op, u = String(req.user || "");
    if (op === "create"){
      if (this.meta) return this.no("exists");
      this.meta = {id: req.id, name: String(req.name || "League").slice(0, 40), code: req.code, creator: u, status: "lobby", members: {[u]: 0}, ver: 0, qlen: req.qlen || 3, created: Date.now(), waiting: {}};
      await this.saveMeta(); return this.ok({meta: this.pub()});
    }
    if (!this.meta) return this.no("There's no such league.");
    const M = this.meta;
    if (op === "join"){
      if (M.members[u] === undefined){
        if (M.status !== "lobby") return this.no("That league already started.");
        if (Object.keys(M.members).length >= 12) return this.no("The league is full.");
        M.members[u] = 0; await this.saveMeta();
      }
      return this.ok({meta: this.pub()});
    }
    if (M.members[u] === undefined) return this.no("You're not in this league.");
    if (op === "meta") return this.ok({meta: this.pub()});
    if (op === "pick"){
      if (M.status !== "lobby") return this.no("The season already started.");
      const t = Math.round(+req.tid);
      if (!(t >= 1 && t <= 34)) return this.no("Pick a team.");
      for (const [k, v] of Object.entries(M.members)) if (v === t && k !== u) return this.no("Someone else took that team.");
      M.members[u] = t; await this.saveMeta(); return this.ok({meta: this.pub()});
    }
    if (op === "leave"){
      if (M.status === "lobby" && u !== M.creator){ delete M.members[u]; await this.saveMeta(); }
      return this.ok({});
    }
    if (op === "start"){
      if (u !== M.creator) return this.no("Only the league creator can start it.");
      if (M.status !== "lobby") return this.no("Already started.");
      if (Object.values(M.members).some(t => !t)) return this.no("Everyone needs to pick a team first.");
      const r = await this.write(req.ents || {}, {}, true, u);
      M.status = "active"; await this.saveMeta(); return this.ok({ver: r.ver, meta: this.pub()});
    }
    if (M.status !== "active") return this.no("The season hasn't started yet.");
    if (op === "since"){
      const v = +req.v || 0, out = {}, del = [], want = [];
      for (const [k, kv] of Object.entries(this.idx)){
        if (kv <= v) continue;
        if (k.startsWith("h:") && k !== "h:" + u) continue;
        want.push(k);
      }
      const got = await this.s.getMany(want.map(k => "e:" + k));
      for (const k of want){ const d = got.get("e:" + k); if (d === undefined || d === null) del.push(k); else out[k] = {v: this.idx[k], d}; }
      return this.ok({ver: M.ver, ents: out, del, meta: this.pub()});
    }
    if (op === "patch"){
      const ents = req.ents || {}, base = req.base || {}, conf = {};
      for (const k of Object.keys(ents)){
        if (k.startsWith("h:") && k !== "h:" + u) return this.no("That's someone else's.");
        const cur = this.idx[k] || 0, b = base[k] || 0;
        if (cur > b){ const d = await this.s.get("e:" + k); const same = (d === undefined || d === null) ? ents[k] === null : d === ents[k]; if (!same) conf[k] = {v: cur, d: d === undefined ? null : d}; }
      }
      if (Object.keys(conf).length && !req.force) return this.no("conflict", {conflicts: conf, ver: M.ver});
      const r = await this.write(ents, req.meta || {}, false, u);
      return this.ok({ver: r.ver, vers: r.vers});
    }
    if (op === "claim"){
      const name = String(req.name || "x"), ttl = Math.min(120, +req.ttl || 60) * 1000, L = (await this.s.get("lock:" + name)) || null;
      if (L && L.until > Date.now() && L.user !== u) return this.no("busy", {by: L.user});
      await this.s.put("lock:" + name, {user: u, until: Date.now() + ttl}); return this.ok({});
    }
    if (op === "release"){
      const name = String(req.name || "x"), L = (await this.s.get("lock:" + name)) || null;
      if (L && L.user === u) await this.s.delete("lock:" + name); return this.ok({});
    }
    if (op === "wait"){
      const key = String(req.key || ""); M.waiting = M.waiting || {};
      for (const k of Object.keys(M.waiting)) if (Date.now() - M.waiting[k].t > 10 * 60e3) delete M.waiting[k];
      if (req.on) M.waiting[key] = {user: u, t: Date.now()}; else if (M.waiting[key] && M.waiting[key].user === u) delete M.waiting[key];
      await this.saveMeta(); return this.ok({});
    }
    if (op === "delete"){
      if (u !== M.creator) return this.no("Only the creator can delete it.");
      await this.s.clear(); this.meta = false; this.idx = {}; return this.ok({deleted: true});
    }
    return this.no("Unknown op.");
  }
  async write(ents, metaPatch, fresh, user){
    const M = this.meta, ver = M.ver + 1, put = {}, del = [], vers = {};
    for (const [k, d] of Object.entries(ents)){
      if (d === null){ if (this.idx[k] || fresh){ del.push("e:" + k); this.idx[k] = ver; vers[k] = ver; } continue; }
      put["e:" + k] = d; this.idx[k] = ver; vers[k] = ver;
    }
    await this.s.putMany(put); if (del.length) await this.s.deleteMany(del);
    M.ver = ver; if (metaPatch && typeof metaPatch === "object"){ if (metaPatch.wk !== undefined) M.wk = metaPatch.wk; if (metaPatch.season !== undefined) M.season = metaPatch.season; }
    await this.s.put("idx", this.idx); await this.saveMeta();
    return {ver, vers};
  }
}
