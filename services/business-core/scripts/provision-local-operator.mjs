import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import pg from "pg";

const databaseUrl = process.env.OPERATOR_SETUP_DATABASE_URL;
assert.ok(databaseUrl, "OPERATOR_SETUP_DATABASE_URL is required");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname),
  "This bootstrap tool is local-only; remote operator provisioning needs a separate reviewed process");
assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Run this tool from an interactive terminal");

const questions = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await questions.question("Wodana operator email: ")).trim().toLowerCase();
const displayName = (await questions.question("Display name: ")).trim();
const roles = [
  "platform_security_owner",
  "provisioning_operator",
  "account_billing_operator",
  "domain_operator",
  "support_observer",
];
const role = (await questions.question(
  `Scoped role (${roles.join(", ")}) [support_observer]: `,
)).trim() || "support_observer";
questions.close();
assert.match(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email");
assert.ok(displayName.length >= 2 && displayName.length <= 160, "Enter a display name (2–160 characters)");
assert.ok(roles.includes(role), "Choose one of the listed scoped operator roles");

function secretPrompt(label) {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " " && value.length < 128) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await secretPrompt("Password (hidden): ");
const confirmation = await secretPrompt("Confirm password (hidden): ");
assert.equal(password, confirmation, "Passwords do not match");
assert.ok(password.length >= 12 && password.length <= 128
  && /[a-z]/.test(password) && /[A-Z]/.test(password)
  && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password),
"Use 12–128 characters with upper/lowercase, a number and a symbol");

const salt = randomBytes(16).toString("hex");
const hash = (await promisify(scryptCallback)(password, salt, 64)).toString("hex");
const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();
try {
  await database.query("BEGIN");
  const existing = await database.query("SELECT id FROM users WHERE primary_email = $1 FOR UPDATE", [email]);
  let userId;
  if (existing.rowCount) {
    userId = existing.rows[0].id;
    const operator = await database.query(
      `SELECT role FROM platform_administrators
       WHERE user_id = $1 AND status = 'active'`, [userId],
    );
    assert.equal(operator.rowCount, 1,
      "This email exists but is not an active operator; refusing to grant platform access");
    assert.equal(operator.rows[0].role, role,
      "This email already has another operator role; use the reviewed role-change process");
    const credentials = await database.query(
      "SELECT 1 FROM local_auth_credentials WHERE user_id = $1", [userId],
    );
    assert.equal(credentials.rowCount, 0,
      "Operator credentials already exist; use the reviewed recovery process, not bootstrap");
  } else {
    const result = await database.query(
      `INSERT INTO users (primary_email, display_name)
       VALUES ($1, $2) RETURNING id`, [email, displayName],
    );
    userId = result.rows[0].id;
    await database.query(
      "INSERT INTO platform_administrators (user_id, role) VALUES ($1, $2)",
      [userId, role],
    );
  }
  await database.query(
    `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
     VALUES ($1, $2, $3)`, [userId, hash, salt],
  );
  await database.query(
    `INSERT INTO user_identities
       (user_id, provider, provider_subject, email_at_provider)
     VALUES ($1, 'local', $2, $3)
     ON CONFLICT (provider, provider_subject) DO NOTHING`, [userId, `local:${userId}`, email],
  );
  await database.query("COMMIT");
  console.log(`Prepared ${email} as ${role}. Open /internal/sign-in and enroll MFA before access is granted.`);
} catch (error) {
  await database.query("ROLLBACK");
  throw error;
} finally {
  await database.end();
}
