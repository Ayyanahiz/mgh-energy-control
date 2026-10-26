// Shared helpers for the MGH Energy Control API: database connection, schema, PIN check.
import { neon } from "@neondatabase/serverless";

let run = null;
let ready = null;

// Tests can inject their own query function: (text, params) => rows
export function setQuery(fn) { run = fn; ready = null; }

function query() {
  if (!run) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw Object.assign(new Error("DATABASE_URL is not set. Connect a Neon Postgres database in Vercel → Storage."), { status: 500, code: "unavailable" });
    const sql = neon(url);
    run = (text, params) => sql.query(text, params || []);
  }
  return run;
}

const SCHEMA = [
  `create table if not exists docs (
     path text primary key,
     collection text not null,
     doc_id text not null,
     data jsonb not null,
     updated_at timestamptz not null default now()
   )`,
  `create index if not exists docs_collection_date on docs (collection, (data->>'date'))`,
  `create or replace function jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
   language plpgsql immutable as $$
   declare k text; r jsonb;
   begin
     if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then return b; end if;
     r := a;
     for k in select jsonb_object_keys(b) loop
       if r ? k then r := jsonb_set(r, array[k], jsonb_deep_merge(r->k, b->k));
       else r := r || jsonb_build_object(k, b->k); end if;
     end loop;
     return r;
   end $$`
];

export async function db() {
  const q = query();
  if (!ready) ready = (async () => { for (const s of SCHEMA) await q(s); })().catch(e => { ready = null; throw e; });
  await ready;
  return q;
}

// Roles: "admin" (ADMIN_PIN) can reopen signed checks and delete; "staff" (APP_PIN) can read and write.
// If neither PIN is set the app is open to anyone with the link (not recommended).
export function role(req) {
  const pin = String(req.headers["x-app-pin"] || "");
  const A = process.env.ADMIN_PIN, P = process.env.APP_PIN;
  if (!A && !P) return "admin";
  if (A && pin === A) return "admin";
  if (P && pin === P) return "staff";
  return null;
}

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export function fail(res, e) {
  send(res, e.status || 500, { code: e.code || "unavailable", message: e.message || "Server error" });
}

export const SEG = /^(?!\.\.?$)[A-Za-z0-9_\-.~:@+]{1,200}$/;
export function checkPath(path, wantDoc) {
  const s = String(path || "").split("/");
  if (s.length < 1 || s.length > 16 || !s.every(x => SEG.test(x))) throw Object.assign(new Error("Bad path"), { status: 400, code: "invalid_argument" });
  if (wantDoc !== (s.length % 2 === 0)) throw Object.assign(new Error(wantDoc ? "A document path needs an even number of segments" : "A collection path needs an odd number of segments"), { status: 400, code: "invalid_argument" });
  return { collection: s.slice(0, -1).join("/"), id: s[s.length - 1] };
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}

export function getQuery(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, "http://x");
  return Object.fromEntries(u.searchParams);
}
