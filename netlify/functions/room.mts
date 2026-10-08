import { getStore } from "@netlify/blobs";

/* Sala en vivo del juego.
   - Quien coordina publica su estado en la clave de la sala: k (su clave), p (estado), t (hora del último cambio), a (última señal).
   - Cada jugador tiene su propia clave, sala/v/<id>: a (última señal), p (lo que respondió en su celular), t (hora de su último cambio).
   Así varias personas pueden escribir a la vez sin pisarse. */
const ALIVE = 40000;
const OLD = 6 * 3600 * 1000;
const CODE = /^eoe-[a-z0-9]{4}$/;
const VID = /^[a-z0-9]{6,24}$/;

export default async (req: Request) => {
  const store = getStore({ name: "salas", consistency: "strong" });
  const now = Date.now();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  const viewers = async (r: string) => {
    const out: any[] = [];
    const { blobs } = await store.list({ prefix: r + "/v/" });
    for (const b of blobs) {
      const v: any = await store.get(b.key, { type: "json" });
      if (!v) continue;
      if (now - (v.a || 0) > OLD) { try { await store.delete(b.key); } catch {} continue; }
      if (now - (v.a || 0) <= ALIVE) out.push({ id: b.key.slice(r.length + 3), p: v.p || null, t: v.t || 0 });
    }
    return out;
  };

  if (req.method === "GET") {
    const url = new URL(req.url);
    const r = url.searchParams.get("r") || "";
    if (!CODE.test(r)) return json({ error: "sala" }, 400);
    const room: any = (await store.get(r, { type: "json" })) || null;
    const vid = url.searchParams.get("v") || "";
    if (url.searchParams.get("hb") && VID.test(vid) && room) {
      const vk = r + "/v/" + vid;
      const v: any = (await store.get(vk, { type: "json" })) || {};
      v.a = now;
      await store.setJSON(vk, v);
    }
    const host = room && room.p ? { p: room.p, t: room.t, a: room.a } : null;
    if (url.searchParams.get("list")) return json({ host, vs: await viewers(r), now });
    return json({ host, now });
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "datos" }, 400); }
    const r = String(body.r || "");
    if (!CODE.test(r)) return json({ error: "sala" }, 400);

    /* Un jugador avisa lo que respondió en su celular. */
    if (body.v !== undefined) {
      const vid = String(body.v);
      if (!VID.test(vid)) return json({ error: "jugador" }, 400);
      const s = JSON.stringify(body.vp ?? null);
      if (s.length > 2000) return json({ error: "grande" }, 413);
      await store.setJSON(r + "/v/" + vid, { a: now, p: body.vp ?? null, t: now });
      return json({ now });
    }

    /* Quien coordina publica el estado de la partida. */
    const k = String(body.k || "").slice(0, 40);
    if (k.length < 8) return json({ error: "sala" }, 400);
    const room: any = (await store.get(r, { type: "json" })) || {};
    if (room.k && room.k !== k && now - (room.a || 0) < ALIVE) return json({ error: "ocupada" }, 409);
    room.k = k;
    room.a = now;
    delete room.v;
    if (body.p && typeof body.p === "object") {
      const s = JSON.stringify(body.p);
      if (s.length > 8000) return json({ error: "grande" }, 413);
      room.p = body.p;
      room.t = now;
    }
    await store.setJSON(r, room);
    return json({ now });
  }

  return json({ error: "metodo" }, 405);
};

export const config = { path: "/api/room" };
