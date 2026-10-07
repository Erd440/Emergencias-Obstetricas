import { getStore } from "@netlify/blobs";


/* Sala en vivo del juego: quien coordina publica su estado y el resto lo consulta.
   Cada sala guarda: k (clave de quien coordina), p (estado), t (hora del último cambio),
   a (última señal de quien coordina) y v (quienes miran, con la hora de su último aviso). */
const ALIVE = 40000;
const CODE = /^eoe-[a-z0-9]{4}$/;

export default async (req: Request) => {
  const store = getStore({ name: "salas", consistency: "strong" });
  const now = Date.now();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const r = url.searchParams.get("r") || "";
    if (!CODE.test(r)) return json({ error: "sala" }, 400);
    const room: any = (await store.get(r, { type: "json" })) || null;
    const vid = (url.searchParams.get("v") || "").slice(0, 24);
    if (url.searchParams.get("hb") && vid && room) {
      room.v = room.v || {};
      room.v[vid] = now;
      for (const k of Object.keys(room.v)) if (now - room.v[k] > ALIVE) delete room.v[k];
      await store.setJSON(r, room);
    }
    const host = room && room.p ? { p: room.p, t: room.t, a: room.a } : null;
    return json({ host, now });
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "datos" }, 400); }
    const r = String(body.r || ""), k = String(body.k || "").slice(0, 40);
    if (!CODE.test(r) || k.length < 8) return json({ error: "sala" }, 400);
    const room: any = (await store.get(r, { type: "json" })) || { v: {} };
    if (room.k && room.k !== k && now - (room.a || 0) < ALIVE) return json({ error: "ocupada" }, 409);
    room.k = k;
    room.a = now;
    if (body.p && typeof body.p === "object") {
      const s = JSON.stringify(body.p);
      if (s.length > 8000) return json({ error: "grande" }, 413);
      room.p = body.p;
      room.t = now;
    }
    room.v = room.v || {};
    for (const x of Object.keys(room.v)) if (now - room.v[x] > ALIVE) delete room.v[x];
    await store.setJSON(r, room);
    return json({ n: Object.keys(room.v).length, now });
  }

  return json({ error: "metodo" }, 405);
};

export const config = { path: "/api/room" };
