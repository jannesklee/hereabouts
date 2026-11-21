// Nextcloud Login Flow v2: the app asks the server for a login URL, the user
// logs in and grants access in their browser, and the app polls until the
// server hands over a freshly created app password.
// https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2
import { Platform } from 'react-native';
import { normalizeUrl } from './config';

export interface LoginFlow {
  loginUrl: string;
  pollEndpoint: string;
  pollToken: string;
}

export interface LoginFlowCredentials {
  loginName: string;
  appPassword: string;
}

// Nextcloud names the app password after the User-Agent of the request that
// starts the flow, so this is what appears under Settings → Security.
const CLIENT_NAME = `Hereabouts (${Platform.OS === 'ios' ? 'iOS' : 'Android'})`;

// The server keeps a started flow valid for 20 minutes.
export const LOGIN_FLOW_TIMEOUT_MS = 20 * 60 * 1000;

/** Adds https:// when the user typed only a host name. */
export function withScheme(url: string): string {
  const trimmed = normalizeUrl(url);
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function startLoginFlow(serverUrl: string): Promise<LoginFlow> {
  const res = await fetch(`${withScheme(serverUrl)}/index.php/login/v2`, {
    method: 'POST',
    headers: { 'User-Agent': CLIENT_NAME, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`login/v2 returned HTTP ${res.status}`);
  const data = await res.json();
  if (
    typeof data?.login !== 'string' ||
    typeof data?.poll?.endpoint !== 'string' ||
    typeof data?.poll?.token !== 'string'
  ) {
    throw new Error('login/v2 returned an unexpected response');
  }
  return {
    loginUrl: data.login,
    pollEndpoint: data.poll.endpoint,
    pollToken: data.poll.token,
  };
}

/** Returns null while the user hasn't granted access yet (the server answers 404). */
export async function pollLoginFlow(
  flow: LoginFlow,
): Promise<LoginFlowCredentials | null> {
  const res = await fetch(flow.pollEndpoint, {
    method: 'POST',
    headers: {
      'User-Agent': CLIENT_NAME,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `token=${encodeURIComponent(flow.pollToken)}`,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`login/v2/poll returned HTTP ${res.status}`);
  const data = await res.json();
  if (typeof data?.loginName !== 'string' || typeof data?.appPassword !== 'string') {
    throw new Error('login/v2/poll returned an unexpected response');
  }
  return { loginName: data.loginName, appPassword: data.appPassword };
}
