// GET /api/query?collection=days&where=[["date",">=","2026-10-01"]]&orderBy=date&dir=desc&limit=90
import { db, role, send, fail, checkPath, getQuery } from "./_lib.js";

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
const OPS = { "==": "=", "!=": "<>", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

export default async function handler(req, res) {
  try {
    if (!role(req)) return send(res, 401, { code: "not_granted", message: "Enter the staff PIN." });
    const p = getQuery(req);
    const collection = String(p.collection || "");
    checkPath(collection, false);
    const where = p.where ? JSON.parse(p.where) : [];
    if (!Array.isArray(where) || where.length > 10) return send(res, 400, { code: "invalid_argument", message: "Too many filters" });
    const params = [collection];
    let sql = "select doc_id, data from docs where collection = $1";
    for (const [f, op, v] of where) {
      if (!FIELD.test(f) || !OPS[op]) return send(res, 400, { code: "invalid_argument", message: "Bad filter" });
      params.push(String(v));
      sql += ` and (data->>'${f}') ${OPS[op]} $${params.length}`;
    }
    if (p.orderBy) {
      if (!FIELD.test(p.orderBy)) return send(res, 400, { code: "invalid_argument", message: "Bad orderBy" });
      sql += ` order by (data->>'${p.orderBy}') ${p.dir === "desc" ? "desc" : "asc"}`;
    } else sql += " order by doc_id";
    const limit = Math.max(1, Math.min(1000, Number(p.limit) || 1000));
    sql += ` limit ${limit}`;
    const q = await db();
    const rows = await q(sql, params);
    send(res, 200, { docs: rows.map(r => ({ id: r.doc_id, data: r.data })) });
  } catch (e) { fail(res, e); }
}
