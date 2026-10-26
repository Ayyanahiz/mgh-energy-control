// GET    /api/doc?path=a/b        read one document
// PUT    /api/doc?path=a/b        replace (create) a document   body: JSON object
// PATCH  /api/doc?path=a/b        deep-merge into an existing document
// DELETE /api/doc?path=a/b        delete (admin PIN only)
import { db, role, send, fail, checkPath, readBody, getQuery } from "./_lib.js";

const MAX = 256 * 1024;

export default async function handler(req, res) {
  try {
    const r = role(req);
    if (!r) return send(res, 401, { code: "not_granted", message: "Enter the staff PIN." });
    const path = String(getQuery(req).path || "");
    const { collection, id } = checkPath(path, true);
    const q = await db();

    if (req.method === "GET") {
      const rows = await q("select data from docs where path = $1", [path]);
      return send(res, 200, rows.length ? { exists: true, data: rows[0].data } : { exists: false });
    }
    if (req.method === "DELETE") {
      if (r !== "admin") return send(res, 403, { code: "not_granted", message: "Only the admin PIN can delete." });
      await q("delete from docs where path = $1", [path]);
      return send(res, 200, { ok: true });
    }
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { code: "invalid_argument", message: "Body must be a JSON object" });
    const json = JSON.stringify(body);
    if (json.length > MAX) return send(res, 400, { code: "invalid_argument", message: "Document is over 256 KB" });

    if (req.method === "PUT") {
      await q(`insert into docs (path, collection, doc_id, data, updated_at) values ($1, $2, $3, $4::jsonb, now())
               on conflict (path) do update set data = excluded.data, updated_at = now()`, [path, collection, id, json]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "PATCH") {
      const rows = await q("update docs set data = jsonb_deep_merge(data, $2::jsonb), updated_at = now() where path = $1 returning path", [path, json]);
      if (!rows.length) return send(res, 400, { code: "invalid_argument", message: "Document does not exist" });
      return send(res, 200, { ok: true });
    }
    send(res, 405, { code: "invalid_argument", message: "Method not allowed" });
  } catch (e) { fail(res, e); }
}
