/* Room logic with no Cloudflare APIs in it, so the same code runs in the Durable Object and in the local test server.
   Two seats per room: "h" (host, runs the game) and "g" (guest). The room only relays; it never looks inside a game message. */
export class RoomCore {
  constructor(io){ this.io = io; this.seats = {h: null, g: null}; this.ck = null; this.last = Date.now(); }
  other(seat){ return seat === "h" ? "g" : "h"; }
  open(seat, conn){
    const old = this.seats[seat]; if (old && old !== conn) this.io.close(old, 4000, "replaced");
    this.seats[seat] = conn; this.last = Date.now();
    const o = this.seats[this.other(seat)];
    this.io.send(conn, JSON.stringify({t: "hello", seat, peer: !!o, ck: this.ck}));
    if (o) this.io.send(o, JSON.stringify({t: "peer", on: true}));
  }
  message(seat, conn, data){
    if (this.seats[seat] !== conn) return;
    this.last = Date.now();
    if (typeof data !== "string" || data.length > 900000) return;
    if (seat === "h" && data.startsWith('{"t":"ck"')){ this.ck = data; this.io.persist && this.io.persist(this.ck); return; }       // host checkpoint, replayed to a host who reconnects
    const o = this.seats[this.other(seat)]; if (o) this.io.send(o, data);
  }
  close(seat, conn){
    if (this.seats[seat] !== conn) return;
    this.seats[seat] = null;
    const o = this.seats[this.other(seat)]; if (o) this.io.send(o, JSON.stringify({t: "peer", on: false}));
  }
}
