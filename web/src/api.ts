import { getInitData } from './telegram';
import type {
  AdminChallenge,
  ChallengePublic,
  DayStatusRow,
  LeaderboardRow,
  LedgerEntry,
  MyChallengesResponse,
  Participant,
  Profile,
  Quote,
  SickResult,
} from './types';

const DEV_ID = import.meta.env.VITE_DEV_TELEGRAM_ID as string | undefined;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Telegram-Init-Data': getInitData(),
    ...(options.headers as Record<string, string> | undefined),
  };
  // Content-Type ставим только когда есть тело — иначе Fastify ругается на пустое JSON-тело
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (DEV_ID) {
    headers['X-Dev-Telegram-Id'] = DEV_ID;
    headers['X-Dev-Name'] = 'Dev User';
  }

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  // --- пользовательские (мультичеллендж) ---
  getMyChallenges: () => request<MyChallengesResponse>('/my/challenges'),
  getChallenge: (id: number) => request<ChallengePublic>(`/challenges/${id}`),
  getMe: (id: number) => request<Profile>(`/challenges/${id}/me`),
  getLeaderboard: (id: number) => request<{ rows: LeaderboardRow[] }>(`/challenges/${id}/leaderboard`),
  reportSick: (id: number) => request<SickResult>(`/challenges/${id}/sick`, { method: 'POST' }),

  // --- админские ---
  adminGetChallenge: () => request<AdminChallenge>('/admin/challenge'),
  adminUpdateChallenge: (data: Partial<AdminChallenge>) =>
    request<AdminChallenge>('/admin/challenge', { method: 'PATCH', body: JSON.stringify(data) }),

  adminGetLedger: () => request<{ bank: number; entries: LedgerEntry[] }>('/admin/ledger'),
  adminAddLedger: (data: { type: 'adjustment' | 'spend'; amount: number; note?: string }) =>
    request<{ ok: boolean; bank: number }>('/admin/ledger', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  adminSetBank: (value: number, note?: string) =>
    request<{ ok: boolean; bank: number }>('/admin/bank/set', {
      method: 'POST',
      body: JSON.stringify({ value, note }),
    }),

  adminGetQuotes: () => request<{ quotes: Quote[] }>('/admin/quotes'),
  adminAddQuote: (text: string) =>
    request<{ id: number }>('/admin/quotes', { method: 'POST', body: JSON.stringify({ text }) }),
  adminUpdateQuote: (id: number, data: { text?: string; isActive?: boolean }) =>
    request<{ id: number }>(`/admin/quotes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  adminDeleteQuote: (id: number) =>
    request<{ ok: boolean }>(`/admin/quotes/${id}`, { method: 'DELETE' }),

  adminGetParticipants: () => request<{ rows: Participant[] }>('/admin/participants'),
  adminUpdateParticipant: (id: number, data: { status?: string; isAdmin?: boolean }) =>
    request<{ ok: boolean }>(`/admin/participants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  adminGetDay: (day: string) =>
    request<{ day: string; rows: DayStatusRow[] }>(`/admin/day/${day}`),
  adminDayOverride: (data: {
    participationId: number;
    day: string;
    action: 'done' | 'missed' | 'sick' | 'clear' | 'fake';
  }) => request<{ ok: boolean }>('/admin/day-override', { method: 'POST', body: JSON.stringify(data) }),

  adminRunReport: (day?: string) =>
    request<{ ok: boolean; sent: boolean; day: string; content: string }>('/admin/report', {
      method: 'POST',
      body: JSON.stringify({ day }),
    }),

  // --- сброс / очистка данных ---
  adminResetLedger: () =>
    request<{ ok: boolean; deleted: number; bank: number }>('/admin/reset/ledger', { method: 'POST' }),
  adminResetParticipants: () =>
    request<{ ok: boolean; removed: number }>('/admin/reset/participants', { method: 'POST' }),
  adminResetChat: () => request<{ ok: boolean }>('/admin/reset/chat', { method: 'POST' }),
  adminResetAll: () => request<{ ok: boolean; bank: number }>('/admin/reset/all', { method: 'POST' }),
};
