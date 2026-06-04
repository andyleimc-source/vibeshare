// Turn raw firebase-tools stderr/output into a stable error code + guidance.
// This encodes every onboarding pitfall hit while building this tool.

export const CODES = {
  FIREBASE_MISSING: 'FIREBASE_MISSING',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  ACCOUNT_MISMATCH: 'ACCOUNT_MISMATCH',
  NO_PROJECT: 'NO_PROJECT',
  TOS_REQUIRED: 'TOS_REQUIRED',
  API_DISABLED: 'API_DISABLED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  QUOTA: 'QUOTA',
  BAD_TTL: 'BAD_TTL',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Classify a failed firebase invocation.
 * @param {string} text - combined stderr+stdout from firebase
 * @returns {{ code: string, hint: string }}
 */
export function classifyFirebaseError(text = '') {
  const t = String(text).toLowerCase();

  if (/not authenticated|no currently active account|run .*firebase login|command requires authentication/.test(t)) {
    return { code: CODES.NOT_LOGGED_IN, hint: 'Run: firebase login' };
  }
  if (/credentials are no longer valid|reauthenticate|invalid_grant|token.*expired/.test(t)) {
    return { code: CODES.AUTH_EXPIRED, hint: 'Run: firebase login --reauth' };
  }
  // Management API disabled on the project — must be checked BEFORE the generic 403.
  if (/firebase\w*\.googleapis\.com.*(disabled|has not been used|not been enabled)/.test(t) ||
      /enable.*firebase.*api/.test(t)) {
    return {
      code: CODES.API_DISABLED,
      hint: 'Open the Firebase console for this project to enable it: https://console.firebase.google.com/',
    };
  }
  // Brand-new account that never accepted Firebase ToS → addFirebase / project ops 403.
  if (/caller does not have permission|permission_denied|the caller does not have permission|insufficient permission|terms of service|tos/.test(t)) {
    return {
      code: CODES.TOS_REQUIRED,
      hint: 'Accept Firebase Terms of Service once in the browser, then create/select a project.',
    };
  }
  if (/quota|rate limit|resource has been exhausted|too many requests/.test(t)) {
    return { code: CODES.QUOTA, hint: 'Firebase quota/rate limit hit — wait and retry.' };
  }
  if (/no projects|failed to get firebase project|project .* does not exist|make sure the project exists/.test(t)) {
    return { code: CODES.NO_PROJECT, hint: 'Run: vibeshare init  (to create/select a Firebase project)' };
  }
  return { code: CODES.DEPLOY_FAILED, hint: '' };
}

/** Parse `firebase login:list` text output into a list of account emails. */
export function parseLoginList(text = '') {
  const out = [];
  const re = /logged in as\s+([^\s]+@[^\s]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  // Also catch the multi-account "[email] (default)" style listings.
  const re2 = /^\s*-?\s*([^\s@]+@[^\s()]+)/gim;
  while ((m = re2.exec(text)) !== null) {
    const email = m[1].trim();
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** Extract the first Firebase Hosting channel URL from arbitrary text (fallback). */
export function extractChannelUrl(text = '') {
  const m = /https:\/\/[a-z0-9.-]+--[a-z0-9-]+\.web\.app/i.exec(text);
  return m ? m[0] : null;
}
