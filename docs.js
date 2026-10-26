// POST /api/docs  { paths: ["a/b", "c/d"] }  → { docs: { "a/b": {exists, data}, ... } }   (used for live polling)
import { db, role, send, fail, checkPath, readBody } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (!role(req)) return send(res, 401, { code: "not_granted", message: "Enter the staff PIN." });
    if (req.method !== "POST") return send(res, 405, { code: "invalid_argument", message: "Use POST" });
    const { paths } = await readBody(req);
    if (!Array.isArray(paths) || paths.length > 64) return send(res, 400, { code: "invalid_argument", message: "paths must be an array of up to 64" });
    paths.forEach(p => checkPath(p, true));
    const q = await db();
    const rows = paths.length ? await q("select path, data from docs where path = any($1::text[])", [paths]) : [];
    const docs = {};
    paths.forEach(p => { docs[p] = { exists: false }; });
    rows.forEach(r => { docs[r.path] = { exists: true, data: r.data }; });
    send(res, 200, { docs });
  } catch (e) { fail(res, e); }
}
