import { getInitData } from './telegram';
import type {
  AdminChallenge,
  AdminChallengeRow,
  AdminFitnessChallenge,
  AdminFitnessInput,
  AdminFitnessParticipant,
  AdminWeekRow,
  BodyProfile,
  ChallengePublic,
  DebtsOverview,
  FeedItem,
  FitnessLeaderboardRow,
  FitnessOverview,
  FoodDay,
  FoodEntryInput,
  FoodProduct,
  FoodProductInput,
  FreezeOverview,
  GoalInput,
  IngestSync,
  HubInfo,
  HubProvider,
  IntegrationsResponse,
  LeaderboardRow,
  LedgerEntry,
  ManualWeightInput,
  Measurement,
  MeasurementKind,
  MyChallengesResponse,
  NotificationSettings,
  Participant,
  PersonalDetail,
  PersonalSummary,
  Profile,
  Quote,
  RecentDaysResponse,
  SickResult,
  WeightOverview,
  Workout,
  WorkoutInput,
} from './types';

const DEV_ID = import.meta.env.VITE_DEV_TELEGRAM_ID as string | undefined;

/** Ошибка API с кодом из тела ответа (`{ "error": "..." }`), если он там был. */
export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, text: string) {
    let code: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') code = parsed.error;
    } catch {
      /* тело не JSON — оставляем как есть */
    }
    super(`HTTP ${status}: ${code ?? text}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

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
    throw new ApiError(res.status, text);
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

  // вступить в группу взвешиваний / выйти из неё
  joinChallenge: (id: number) =>
    request<{ ok: boolean; id: number }>(`/challenges/${id}/join`, { method: 'POST' }),
  leaveChallenge: (id: number) =>
    request<{ ok: boolean }>(`/challenges/${id}/leave`, { method: 'POST' }),

  // --- заморозки серии (только личный кабинет) ---
  getFreezes: (id: number) => request<FreezeOverview>(`/challenges/${id}/freezes`),
  useFreeze: (id: number, day: string) =>
    request<{ ok: boolean; day: string; earnedDay: string; freezes: FreezeOverview }>(
      `/challenges/${id}/freezes`,
      { method: 'POST', body: JSON.stringify({ day }) },
    ),

  // --- личные челленджи ---
  getPersonal: () => request<{ challenges: PersonalSummary[] }>('/personal'),
  createPersonal: (title: string) =>
    request<{ id: number }>('/personal', { method: 'POST', body: JSON.stringify({ title }) }),
  getPersonalDetail: (id: number) => request<PersonalDetail>(`/personal/${id}`),
  addSet: (id: number, reps: number) =>
    request<{ ok: boolean }>(`/personal/${id}/sets`, { method: 'POST', body: JSON.stringify({ reps }) }),
  deleteSet: (id: number, setId: number) =>
    request<{ ok: boolean }>(`/personal/${id}/sets/${setId}`, { method: 'DELETE' }),
  deletePersonal: (id: number) =>
    request<{ ok: boolean }>(`/personal/${id}`, { method: 'DELETE' }),

  // --- вес с умных весов ---
  getWeight: () => request<WeightOverview>('/weight'),
  deleteWeightEntry: (id: number) =>
    request<{ ok: boolean }>('/weight/' + id, { method: 'DELETE' }),
  addManualWeight: (data: ManualWeightInput) =>
    request<WeightOverview>('/weight', { method: 'POST', body: JSON.stringify(data) }),

  // --- фитнес-челлендж: цель, анкета, обхваты ---
  getFitness: (id: number) => request<FitnessOverview>(`/challenges/${id}/fitness`),
  saveGoal: (id: number, data: GoalInput) =>
    request<FitnessOverview>(`/challenges/${id}/goal`, { method: 'PUT', body: JSON.stringify(data) }),
  saveBodyProfile: (data: Partial<BodyProfile>) =>
    request<BodyProfile>('/body-profile', { method: 'PUT', body: JSON.stringify(data) }),
  getMeasurements: () => request<{ rows: Measurement[] }>('/measurements'),
  saveMeasurement: (data: { kind: MeasurementKind; value: number; day?: string }) =>
    request<{ rows: Measurement[] }>('/measurements', { method: 'PUT', body: JSON.stringify(data) }),
  deleteMeasurement: (id: number) =>
    request<{ rows: Measurement[] }>(`/measurements/${id}`, { method: 'DELETE' }),

  // --- фитнес-челлендж: тренировки, рейтинг ---
  getFitnessWorkouts: (id: number) =>
    request<{ workouts: Workout[]; sports: string[] }>(`/challenges/${id}/fitness/workouts`),
  getFitnessLeaderboard: (id: number) =>
    request<{ rows: FitnessLeaderboardRow[]; feed: FeedItem[] }>(`/challenges/${id}/fitness/leaderboard`),
  addWorkout: (data: WorkoutInput) =>
    request<{ ok: boolean; id: number }>('/workouts', { method: 'POST', body: JSON.stringify(data) }),
  deleteWorkout: (id: number) => request<{ ok: boolean }>(`/workouts/${id}`, { method: 'DELETE' }),

  // --- питание ---
  getFoodDay: (day?: string) => request<FoodDay>(`/food/day${day ? `?day=${day}` : ''}`),
  addFoodEntry: (data: FoodEntryInput) =>
    request<FoodDay>('/food/entries', { method: 'POST', body: JSON.stringify(data) }),
  deleteFoodEntry: (id: number) => request<{ ok: boolean }>(`/food/entries/${id}`, { method: 'DELETE' }),
  searchFood: (q: string) => request<{ products: FoodProduct[] }>(`/food/search?q=${encodeURIComponent(q)}`),
  searchFoodOff: (q: string) =>
    request<{ products: FoodProduct[] }>(`/food/search/off?q=${encodeURIComponent(q)}`),
  getRecentFood: () => request<{ products: FoodProduct[] }>('/food/recent'),
  createFoodProduct: (data: FoodProductInput) =>
    request<FoodProduct>('/food/products', { method: 'POST', body: JSON.stringify(data) }),

  // --- подключения источников тренировок ---
  getIntegrations: () => request<IntegrationsResponse>('/integrations'),
  connectWhoop: () => request<{ url: string }>('/integrations/whoop/connect', { method: 'POST' }),
  disconnectWhoop: () => request<{ ok: boolean }>('/integrations/whoop', { method: 'DELETE' }),
  connectHub: (provider: HubProvider) =>
    request<{ hubs: HubInfo[] }>(`/integrations/hubs/${provider}`, { method: 'POST' }),
  rotateHubToken: (provider: HubProvider) =>
    request<{ hubs: HubInfo[] }>(`/integrations/hubs/${provider}/rotate`, { method: 'POST' }),
  disconnectHub: (provider: HubProvider) =>
    request<{ hubs: HubInfo[] }>(`/integrations/hubs/${provider}`, { method: 'DELETE' }),

  // --- админка фитнеса: недели, жизни, модерация ---
  adminFitnessWeeks: (id: number) =>
    request<{ weeks: { weekNumber: number; rows: AdminWeekRow[] }[] }>(`/admin/challenges/${id}/weeks`),
  adminWeekAction: (id: number, weekId: number, action: 'forgive' | 'unforgive' | 'recalc', note?: string) =>
    request<{ ok: boolean; passed: boolean; done: number; required: number }>(
      `/admin/challenges/${id}/weeks/${weekId}/${action}`,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),
  adminReinstate: (id: number, participationId: number) =>
    request<{ ok: boolean; forgivenWeekNumbers: number[] }>(
      `/admin/challenges/${id}/participants/${participationId}/reinstate`,
      { method: 'POST' },
    ),
  adminParticipantWorkouts: (id: number, participationId: number) =>
    request<{ workouts: Workout[] }>(`/admin/challenges/${id}/participants/${participationId}/workouts`),
  adminParticipantSyncs: (id: number, participationId: number) =>
    request<{ syncs: IngestSync[] }>(`/admin/challenges/${id}/participants/${participationId}/syncs`),
  adminExcludeWorkout: (id: number, workoutId: number, excluded: boolean, note?: string) =>
    request<{ ok: boolean }>(`/admin/challenges/${id}/workouts/${workoutId}`, {
      method: 'PATCH',
      body: JSON.stringify({ excluded, note }),
    }),
  adminForceCountWorkout: (id: number, workoutId: number, forceCounted: boolean, note?: string) =>
    request<{ ok: boolean }>(`/admin/challenges/${id}/workouts/${workoutId}`, {
      method: 'PATCH',
      body: JSON.stringify({ forceCounted, note }),
    }),
  adminEvaluate: (id: number) =>
    request<{ ok: boolean; created: number; dm: number; chat: boolean }>(
      `/admin/challenges/${id}/evaluate`,
      { method: 'POST' },
    ),

  // --- админка челленджей по id (фитнес) ---
  adminListChallenges: () => request<{ rows: AdminChallengeRow[] }>('/admin/challenges'),
  adminCreateFitness: (data: AdminFitnessInput) =>
    request<AdminFitnessChallenge>('/admin/challenges', { method: 'POST', body: JSON.stringify(data) }),
  adminGetFitness: (id: number) => request<AdminFitnessChallenge>(`/admin/challenges/${id}`),
  adminUpdateFitness: (id: number, data: AdminFitnessInput) =>
    request<AdminFitnessChallenge>(`/admin/challenges/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  adminFitnessParticipants: (id: number) =>
    request<{ rows: AdminFitnessParticipant[] }>(`/admin/challenges/${id}/participants`),

  // --- админские ---
  getNotifications: (challengeId: number) =>
    request<NotificationSettings>(`/challenges/${challengeId}/notifications`),
  updateNotification: (
    challengeId: number,
    data: { type: string; enabled?: boolean | null; time?: string | null },
  ) =>
    request<NotificationSettings>(`/challenges/${challengeId}/notifications`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

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

  adminGetDebts: () => request<DebtsOverview>('/admin/debts'),
  adminAddPayment: (data: { participationId: number; amount: number; note?: string }) =>
    request<DebtsOverview & { ok: boolean }>('/admin/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  adminDeletePayment: (id: number) =>
    request<DebtsOverview & { ok: boolean }>(`/admin/payments/${id}`, { method: 'DELETE' }),

  adminGetParticipants: () => request<{ rows: Participant[] }>('/admin/participants'),
  adminUpdateParticipant: (id: number, data: { status?: string; isAdmin?: boolean }) =>
    request<{ ok: boolean }>(`/admin/participants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  adminGetRecent: (params: { days?: number; before?: string; participationId?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.days) q.set('days', String(params.days));
    if (params.before) q.set('before', params.before);
    if (params.participationId) q.set('participationId', String(params.participationId));
    const qs = q.toString();
    return request<RecentDaysResponse>(`/admin/recent${qs ? `?${qs}` : ''}`);
  },
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
