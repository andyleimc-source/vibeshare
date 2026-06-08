// Access gate: turn a plaintext HTML page into a self-contained, credential-gated
// page using the Web Crypto API. No backend, no central server — the gate runs
// entirely in the visitor's browser.
//
// Scheme (all gated modes):
//   - A random 32-byte content key CK encrypts the page (AES-256-GCM).
//   - CK is *wrapped* (AES-256-GCM) under a key derived (PBKDF2-SHA256) from each
//     allowed identity. Entering a valid credential re-derives that key, unwraps
//     CK, and decrypts the page. Wrapped entries carry no hint → the allow-list
//     is not revealed in the source.
//
// Identity per mode:
//   password        secret = <password>                       (real: content is encrypted)
//   email           secret = <normalized-email>              (SOFT: emails aren't secret)
//   email_password  secret = <normalized-email> "\n" <password>  (password adds the entropy)
//
// Honest caveat: a 4-digit numeric PIN is offline-brute-forceable; email-only is
// a soft gate. For anything sensitive use a long password (or email+password).

import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';

export const PBKDF2_ITERS = 210000;
const KEYLEN = 32; // AES-256

export const ACCESS_MODES = new Set(['anyone', 'password', 'email', 'email_password']);

export function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function deriveKey(secret, salt) {
  return pbkdf2Sync(Buffer.from(secret, 'utf8'), salt, PBKDF2_ITERS, KEYLEN, 'sha256');
}

/** AES-256-GCM encrypt → { iv, data } where data = ciphertext||authTag, both base64. */
function gcmEncrypt(key, plaintextBuf) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), data: Buffer.concat([ct, tag]).toString('base64') };
}

/** Build the per-mode list of identity secrets that should unlock the page. */
function identitySecrets(mode, { pin, emails }) {
  const list = (emails || []).map(normalizeEmail).filter(Boolean);
  switch (mode) {
    case 'password':
      return [String(pin)];
    case 'email':
      return list;
    case 'email_password':
      return list.map((e) => `${e}\n${String(pin)}`);
    default:
      throw new Error(`gate: unsupported mode ${mode}`);
  }
}

/**
 * Produce the gated HTML for a page.
 * @param {string} html  plaintext page
 * @param {{mode:string, pin?:string, emails?:string[], title?:string}} spec
 * @returns {string} self-contained gated HTML (or the original html for mode "anyone")
 */
export function gateHtml(html, spec) {
  const { mode } = spec;
  if (mode === 'anyone') return html;
  if (!ACCESS_MODES.has(mode)) throw new Error(`gate: unknown mode ${mode}`);

  const salt = randomBytes(16);
  const ck = randomBytes(KEYLEN);
  const content = gcmEncrypt(ck, Buffer.from(html, 'utf8'));
  const secrets = identitySecrets(mode, spec);
  if (secrets.length === 0) throw new Error('gate: no credentials provided');
  const wrapped = secrets.map((s) => gcmEncrypt(deriveKey(s, salt), ck));

  const params = {
    v: 1,
    mode,
    iters: PBKDF2_ITERS,
    salt: salt.toString('base64'),
    content,
    wrapped,
  };
  return renderGateTemplate(params, spec.title || 'Protected');
}

function renderGateTemplate(params, title) {
  const needEmail = params.mode === 'email' || params.mode === 'email_password';
  const needPass = params.mode === 'password' || params.mode === 'email_password';
  const safeTitle = String(title).replace(/</g, '&lt;');
  const blob = JSON.stringify(params).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:#0f1115; color:#e8e8ea; }
  .card { width:min(92vw,360px); padding:28px 26px; border-radius:16px;
    background:#181b22; box-shadow:0 12px 40px rgba(0,0,0,.45); }
  h1 { font-size:17px; margin:0 0 4px; font-weight:600; }
  p.sub { margin:0 0 18px; color:#9aa0aa; font-size:13px; }
  label { display:block; font-size:12px; color:#9aa0aa; margin:12px 0 5px; }
  input { width:100%; padding:11px 12px; border-radius:10px; border:1px solid #2a2f3a;
    background:#0f1115; color:#e8e8ea; font-size:15px; outline:none; }
  input:focus { border-color:#4f7cff; }
  button { width:100%; margin-top:18px; padding:11px; border:0; border-radius:10px;
    background:#4f7cff; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .err { color:#ff6b6b; font-size:13px; min-height:18px; margin-top:12px; }
  .foot { margin-top:16px; text-align:center; font-size:11px; color:#5a606b; }
</style>
</head>
<body>
  <form class="card" id="g" autocomplete="off">
    <h1>🔒 ${safeTitle}</h1>
    <p class="sub">Enter your credentials to open this page.</p>
    ${needEmail ? '<label>Email</label><input id="email" type="email" autocomplete="off" placeholder="you@example.com">' : ''}
    ${needPass ? '<label>Password</label><input id="pass" type="password" autocomplete="off" placeholder="••••">' : ''}
    <button type="submit" id="go">Open</button>
    <div class="err" id="err"></div>
    <div class="foot">Protected with vibeshare · client-side encrypted</div>
  </form>
<script>
const P = ${blob};
const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(secret, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:P.iters, hash:'SHA-256' },
    km, { name:'AES-GCM', length:256 }, false, ['decrypt']);
}
async function tryDecrypt(key, blob) {
  return new Uint8Array(await crypto.subtle.decrypt({ name:'AES-GCM', iv: dec(blob.iv) }, key, dec(blob.data)));
}
async function unlock(secret) {
  const salt = dec(P.salt);
  const wrapKey = await deriveKey(secret, salt);
  for (const w of P.wrapped) {
    let ckBytes;
    try { ckBytes = await tryDecrypt(wrapKey, w); } catch { continue; }
    const ck = await crypto.subtle.importKey('raw', ckBytes, 'AES-GCM', false, ['decrypt']);
    const html = new TextDecoder().decode(await tryDecrypt(ck, P.content));
    return html;
  }
  return null;
}
const f = document.getElementById('g'), err = document.getElementById('err'), go = document.getElementById('go');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent=''; go.disabled=true; go.textContent='Opening…';
  try {
    const email = document.getElementById('email')?.value.trim().toLowerCase() || '';
    const pass = document.getElementById('pass')?.value || '';
    let secret;
    if (P.mode==='password') secret = pass;
    else if (P.mode==='email') secret = email;
    else secret = email + '\\n' + pass;
    const html = await unlock(secret);
    if (html == null) { err.textContent='Incorrect credentials.'; go.disabled=false; go.textContent='Open'; return; }
    document.open(); document.write(html); document.close();
  } catch (ex) {
    err.textContent='Something went wrong: ' + (ex.message||ex); go.disabled=false; go.textContent='Open';
  }
});
</script>
</body>
</html>`;
}

/** The "this page is closed" stub served at a disabled page's URL. */
export function disabledStub(title = 'vibeshare') {
  const t = String(title).replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Page closed</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC",sans-serif;background:#0f1115;color:#e8e8ea}
.b{text-align:center;padding:32px}.i{font-size:40px}h1{font-size:18px;margin:14px 0 6px}p{color:#9aa0aa;margin:0;font-size:13px}</style>
</head><body><div class="b"><div class="i">🚪</div><h1>This page is closed</h1>
<p>${t} is not available right now.</p></div></body></html>`;
}

/** Generic landing page served at the site root — never lists slugs. */
export function landingPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>vibeshare</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1115;color:#9aa0aa}
.b{text-align:center}</style></head><body><div class="b">Nothing to see here.</div></body></html>`;
}
