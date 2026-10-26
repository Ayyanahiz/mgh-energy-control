// GET /api/whoami → { role: "admin" | "staff" }   401 when the PIN is wrong
import { role, send } from "./_lib.js";
export default function handler(req, res) {
  const r = role(req);
  if (!r) return send(res, 401, { code: "not_granted", message: "Enter the staff PIN." });
  send(res, 200, { role: r, open: !process.env.APP_PIN && !process.env.ADMIN_PIN });
}
