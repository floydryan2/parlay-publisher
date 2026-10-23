import {RoomCore} from "./core.js";
import {LeagueCore} from "./league.js";

const enc = new TextEncoder();
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function hmacKey(secret){ return crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]); }
export async function verifyToken(secret, token){
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  let ok = false; try { ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let d; try { d = JSON.parse(new TextDecoder().decode(unb64u(body))); } catch { return null; }
  if (!d || !d.r || (d.s !== "h" && d.s !== "g") || !d.u || (d.e || 0) < Date.now()) return null;
  return d;
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname.startsWith("/lg/")){
      if (!env.LIVE_SECRET || req.headers.get("x-live-key") !== env.LIVE_SECRET) return new Response("no", {status: 403});
      const lid = url.pathname.slice(4).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
      if (!lid) return new Response("bad", {status: 400});
      return env.LEAGUE.get(env.LEAGUE.idFromName(lid)).fetch(new Request("https://lg/", {method: "POST", body: req.body}));
    }
    if (url.pathname !== "/ws") return new Response("Not found", {status: 404});
    if (req.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", {status: 426});
    if (!env.LIVE_SECRET) return new Response("LIVE_SECRET is not set on this Worker", {status: 500});
    const d = await verifyToken(env.LIVE_SECRET, url.searchParams.get("t"));
    if (!d) return new Response("Bad or expired pass", {status: 401});
    const id = env.ROOM.idFromName(d.r), stub = env.ROOM.get(id);
    const u = new URL(req.url); u.search = "?seat=" + d.s + "&u=" + encodeURIComponent(d.u);
    return stub.fetch(new Request(u.toString(), req));
  }
};

export class LiveRoom {
  constructor(state, env){
    this.state = state; this.env = env;
    this.core = new RoomCore({
      send: (ws, m) => { try { ws.send(m); } catch {} },
      close: (ws, c, r) => { try { ws.close(c, r); } catch {} },
      persist: m => { this.state.storage.put("ck", m); }
    });
    this.state.blockConcurrencyWhile(async () => {            // after the room slept: rebuild who is connected from the sockets that survived
      this.core.ck = (await this.state.storage.get("ck")) || null;
      for (const ws of this.state.getWebSockets()){ const a = ws.deserializeAttachment(); if (a && a.seat) this.core.seats[a.seat] = ws; }
    });
  }
  async fetch(req){
    const url = new URL(req.url), seat = url.searchParams.get("seat");
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({seat, u: url.searchParams.get("u")});
    this.core.open(seat, server);
    await this.state.storage.setAlarm(Date.now() + 6 * 3600 * 1000);
    return new Response(null, {status: 101, webSocket: client});
  }
  webSocketMessage(ws, data){ const a = ws.deserializeAttachment(); if (a) this.core.message(a.seat, ws, data); }
  webSocketClose(ws){ const a = ws.deserializeAttachment(); if (a) this.core.close(a.seat, ws); }
  webSocketError(ws){ const a = ws.deserializeAttachment(); if (a) this.core.close(a.seat, ws); }
  async alarm(){
    if (this.state.getWebSockets().length) { await this.state.storage.setAlarm(Date.now() + 6 * 3600 * 1000); return; }
    await this.state.storage.deleteAll();
  }
}

/* one Durable Object per multiplayer league: the shared Career state */
export class League {
  constructor(state, env){
    this.state = state; const st = state.storage;
    this.core = new LeagueCore({
      get: k => st.get(k), put: (k, v) => st.put(k, v), delete: k => st.delete(k),
      async getMany(keys){ const out = new Map(); for (let i = 0; i < keys.length; i += 128){ const m = await st.get(keys.slice(i, i + 128)); for (const [k, v] of m) out.set(k, v); } return out; },
      async putMany(o){ const ks = Object.keys(o); for (let i = 0; i < ks.length; i += 128){ const part = {}; for (const k of ks.slice(i, i + 128)) part[k] = o[k]; await st.put(part); } },
      async deleteMany(keys){ for (let i = 0; i < keys.length; i += 128) await st.delete(keys.slice(i, i + 128)); },
      clear: () => st.deleteAll()
    });
  }
  async fetch(req){
    let b; try { b = await req.json(); } catch { return Response.json({ok: false, error: "bad json"}, {status: 400}); }
    const r = await this.state.blockConcurrencyWhile(() => this.core.handle(b));
    return Response.json(r);
  }
}
