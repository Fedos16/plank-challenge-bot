export interface ChallengePublic {
  id: number;
  kind: string;
  title: string;
  description: string;
  rulesText: string;
  timezone: string;
  startDate: string;
  dayNumber: number;
  dailyDeadline: string;
  sickDeadline: string;
  minDurationSec: number;
  fineAmount: number;
  fakeFineMultiplier: number;
  freezeEveryDays: number;
  maxFreezes: number;
  bank: number;
}

export type DayState =
  | 'done'
  | 'late'
  | 'fake'
  | 'rejected'
  | 'sick'
  | 'frozen'
  | 'missed'
  | 'pending';

export interface WeightSummary {
  latestKg: number | null;
  day: string | null;
  weekDelta: number | null;
  count: number;
}

export type ChallengePhase = 'upcoming' | 'running' | 'finished';

export interface FitnessSummary {
  dayNumber: number;
  daysTotal: number | null;
  phase: ChallengePhase;
  hasGoal: boolean;
  progressPercent: number | null;
  livesLeft: number;
  livesTotal: number;
  eliminated: boolean;
  week: { done: number; required: number } | null;
}

export interface MyChallenge {
  id: number;
  key: string;
  /** plank — планка со штрафами, weight — группа взвешиваний, fitness — тренировки и цели */
  kind: string;
  title: string;
  description: string;
  dayNumber: number;
  todayState?: DayState;
  currentStreak?: number;
  bank?: number;
  weight?: WeightSummary;
  fitness?: FitnessSummary;
}

export interface AvailableChallenge {
  id: number;
  key: string;
  kind: string;
  title: string;
  description: string;
}

export interface MyChallengesResponse {
  user: { name: string; username: string | null; photoUrl: string | null; isAdmin: boolean };
  challenges: MyChallenge[];
  available: AvailableChallenge[];
}

export interface SickResult {
  ok: boolean;
  valid: boolean;
  day: string;
  sickDeadline: string;
}

export interface PersonalSummary {
  id: number;
  title: string;
  unit: string;
  todayReps: number;
  todaySets: number;
  currentStreak: number;
  totalReps: number;
}

export interface PersonalDetail {
  id: number;
  title: string;
  unit: string;
  today: { day: string; totalReps: number; sets: { id: number; reps: number }[] };
  streak: number;
  totals: { totalReps: number; totalSets: number; daysActive: number; bestDayReps: number };
  history: { day: string; totalReps: number; setCount: number }[];
}

export interface Profile {
  user: { name: string; username: string | null; photoUrl: string | null };
  isAdmin: boolean;
  challenge: { id: number; title: string; dayNumber: number; startDate: string };
  todayState: DayState;
  streak: { current: number; max: number };
  totals: { done: number; late: number; missed: number; sick: number; finesTotal: number };
  freezes: {
    enabled: boolean;
    available: number;
    used: number;
    earned: number;
    max: number;
    everyDays: number;
    daysToNext: number | null;
    canUse: boolean;
  };
}

export interface FreezeUsage {
  day: string;
  earnedDay: string;
  createdAt: string;
}

export interface FreezableDay {
  day: string;
  dayNumber: number;
}

export interface FreezeOverview {
  enabled: boolean;
  everyDays: number;
  max: number;
  earned: number;
  used: number;
  available: number;
  grants: string[];
  usages: FreezeUsage[];
  daysToNext: number | null;
  runLength: number;
  earliestUsableDay: string | null;
  freezableDays: FreezableDay[];
}

export interface LeaderboardRow {
  participationId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
  currentStreak: number;
  maxStreak: number;
  doneCount: number;
}

export interface AdminChallenge {
  id: number;
  key: string;
  title: string;
  description: string;
  rulesText: string;
  isActive: boolean;
  timezone: string;
  startDate: string;
  dailyDeadline: string;
  sickDeadline: string;
  minDurationSec: number;
  fineAmount: number;
  fakeFineMultiplier: number;
  chatId: string | null;
  freezeStreakOnSick: boolean;
  freezeEveryDays: number;
  maxFreezes: number;
  dmReminders: boolean;
  reportTime: string;
  reminderTime: string;
  lastChanceTime: string;
  bank?: number;
}

export interface Quote {
  id: number;
  text: string;
  isActive: boolean;
  global: boolean;
  lastUsedAt: string | null;
}

export interface LedgerEntry {
  id: number;
  type: string;
  amount: number;
  day: string | null;
  note: string | null;
  createdAt: string;
  participant: string | null;
}

export interface DebtRow {
  participationId: number;
  userId: number;
  name: string;
  status: string;
  accrued: number;
  paid: number;
  debt: number;
}

export interface PaymentEntry {
  id: number;
  participationId: number | null;
  participant: string | null;
  amount: number;
  note: string | null;
  createdAt: string;
}

export interface DebtsOverview {
  rows: DebtRow[];
  recentPayments: PaymentEntry[];
  totals: { accrued: number; paid: number; debt: number };
}

export interface Participant {
  participationId: number;
  userId: number;
  telegramId: string;
  name: string;
  username: string | null;
  isAdmin: boolean;
  status: string;
  joinedAt: string;
  currentStreak: number;
  maxStreak: number;
  freezesAvailable: number;
  freezesUsed: number;
  freezesEarned: number;
}

export interface RecentDayRow {
  participationId: number;
  name: string;
  status: string;
  state: DayState;
  submittedAt: string | null;
  videoDuration: number | null;
  fine: number;
  finesTotal: number;
  freezeEarnedDay: string | null;
  joined: boolean;
  left: boolean;
}

export interface RecentDay {
  day: string;
  dayNumber: number;
  rows: RecentDayRow[];
}

export interface RecentParticipant {
  participationId: number;
  name: string;
  status: string;
}

export interface RecentDaysResponse {
  days: RecentDay[];
  from: string | null;
  to: string | null;
  hasMore: boolean;
  nextBefore: string | null;
  participants: RecentParticipant[];
}

export interface NotificationSetting {
  type: string;
  title: string;
  description: string;
  enabled: boolean | null;
  time: string | null;
  effectiveEnabled: boolean;
  effectiveTime: string;
  defaultEnabled: boolean;
  defaultTime: string;
}

export interface NotificationSettings {
  slots: string[];
  settings: NotificationSetting[];
}

export interface WeightPoint {
  id: number;
  measuredAt: string;
  day: string;
  weightKg: number;
  bodyFat: number | null;
  water: number | null;
  muscle: number | null;
}

export interface ScaleProfile {
  id: number;
  scaleUserId: number;
  scaleUsername: string | null;
  targetUserId: number;
  targetName: string;
  entries: number;
  lastWeightKg: number | null;
  lastSeenAt: string;
}

export interface WeightOverview {
  connection: { webhookUrl: string; token: string; configured: boolean };
  latest: WeightPoint | null;
  deltas: { week: number | null; month: number | null; total: number | null };
  stats: { count: number; min: number | null; max: number | null; firstDay: string | null };
  history: WeightPoint[];
  profiles: ScaleProfile[];
  candidates: { userId: number; name: string }[];
}

// ---------- Фитнес-челлендж ----------

export type GoalType = 'lose_weight' | 'lose_fat' | 'gain_muscle' | 'custom';
export type GoalMetric = 'weightKg' | 'bodyFat' | 'muscle';
export type Sex = 'male' | 'female';
export type MeasurementKind = 'waist' | 'chest' | 'hips' | 'thigh' | 'biceps' | 'neck';

export interface BodyProfile {
  heightCm: number | null;
  birthYear: number | null;
  sex: Sex | null;
  activityFactor: number;
  /** Показывать другим участникам вес и % жира, а не только процент к цели. */
  shareBody: boolean;
}

export interface Goal {
  goalType: GoalType;
  targetValue: number | null;
  startWeightKg: number | null;
  startBodyFat: number | null;
  startMuscle: number | null;
  startDay: string | null;
  dailyKcalTarget: number | null;
  note: string | null;
}

export interface GoalProgress {
  /** Показатель цели; у свободной цели — null, и процента нет. */
  metric: GoalMetric | null;
  start: number | null;
  target: number | null;
  current: number | null;
  percent: number | null;
}

export interface FitnessSettings {
  weeklyWorkouts: number;
  lives: number;
  minWorkoutMin: number;
  maxWorkoutsPerDay: number;
  weekCloseTime: string;
}

export interface ChallengeTimeline {
  startDate: string;
  endDate: string | null;
  daysTotal: number | null;
  dayNumber: number;
  phase: ChallengePhase;
}

export interface FitnessParticipant {
  participationId: number;
  name: string;
  isMe: boolean;
  goalType: GoalType | null;
  progressPercent: number | null;
  /** Цифры видны, только если участник сам открыл их в анкете. */
  body: { start: number | null; current: number | null; target: number | null } | null;
}

export interface FitnessOverview {
  challenge: ChallengeTimeline & {
    id: number;
    title: string;
    description: string;
    rulesText: string;
    timezone: string;
    weekNumber: number;
    weeksTotal: number | null;
  };
  settings: FitnessSettings;
  bodyProfile: BodyProfile;
  goal: Goal | null;
  progress: GoalProgress | null;
  game: GameState;
  participants: FitnessParticipant[];
}

export interface LivesInfo {
  total: number;
  left: number;
  eliminated: boolean;
  eliminatedAtWeekNumber: number | null;
}

export interface CurrentWeek {
  weekNumber: number;
  start: string;
  end: string;
  required: number;
  done: number;
  days: { day: string; count: number; isToday: boolean; isFuture: boolean; inWindow: boolean }[];
}

export type WeekStatus = 'passed' | 'failed' | 'forgiven';

export interface WeekHistory {
  id: number;
  weekNumber: number;
  start: string;
  end: string;
  required: number;
  done: number;
  status: WeekStatus;
  lifeLost: boolean;
  outOfGame: boolean;
  forgivenNote: string | null;
  upgraded: boolean;
}

export interface GameState {
  lives: LivesInfo;
  currentWeek: CurrentWeek | null;
  history: WeekHistory[];
  totalCounted: number;
}

/** Идёт ли тренировка в зачёт недели и если нет — почему. */
export type Verdict = 'counted' | 'too_short' | 'duplicate' | 'excluded' | 'day_limit';

export interface Workout {
  id: number;
  source: string;
  sport: string;
  sportRaw: string | null;
  startedAt: string;
  durationMin: number;
  kcal: number | null;
  avgHr: number | null;
  distanceM: number | null;
  note: string | null;
  verdict: Verdict;
  excludedNote: string | null;
}

export interface WorkoutInput {
  clientId: string;
  sport: string;
  startedAt: string;
  durationMin: number;
  kcal?: number | null;
  distanceM?: number | null;
  avgHr?: number | null;
  note?: string | null;
  tzOffsetMin?: number;
}

export interface FitnessLeaderboardRow {
  participationId: number;
  name: string;
  photoUrl: string | null;
  isMe: boolean;
  livesLeft: number;
  livesTotal: number;
  eliminated: boolean;
  eliminatedAtWeekNumber: number | null;
  week: { done: number; required: number } | null;
  normPercent: number | null;
  totalCounted: number;
  goalType: GoalType | null;
  progressPercent: number | null;
}

export interface FeedItem extends Workout {
  name: string;
  isMe: boolean;
}

export interface AdminWeekRow extends WeekHistory {
  participationId: number;
  name: string;
}

export interface GoalInput {
  goalType: GoalType;
  targetValue: number | null;
  startWeightKg: number | null;
  startBodyFat: number | null;
  startMuscle: number | null;
  dailyKcalTarget: number | null;
  note: string | null;
}

export interface Measurement {
  id: number;
  day: string;
  kind: MeasurementKind;
  value: number;
}

export interface ManualWeightInput {
  weightKg: number;
  bodyFat?: number | null;
  muscle?: number | null;
  water?: number | null;
  measuredAt?: string;
}

export interface AdminChallengeRow extends ChallengeTimeline {
  id: number;
  kind: string;
  title: string;
  isActive: boolean;
  participants: number;
}

export interface AdminFitnessChallenge extends ChallengeTimeline, FitnessSettings {
  id: number;
  key: string;
  kind: string;
  title: string;
  description: string;
  rulesText: string;
  isActive: boolean;
  joinOpen: boolean;
  timezone: string;
  durationDays: number | null;
  chatId: string | null;
}

export type AdminFitnessInput = Partial<
  Pick<
    AdminFitnessChallenge,
    | 'title' | 'description' | 'rulesText' | 'timezone' | 'isActive' | 'joinOpen' | 'startDate'
    | 'weeklyWorkouts' | 'lives' | 'minWorkoutMin' | 'maxWorkoutsPerDay' | 'weekCloseTime' | 'chatId'
  >
> & { durationDays?: number | null | '' };

export interface AdminFitnessParticipant {
  participationId: number;
  userId: number;
  name: string;
  username: string | null;
  status: string;
  joinedAt: string;
  goalType: GoalType | null;
  progress: GoalProgress | null;
  lives: LivesInfo;
  week: { done: number; required: number } | null;
  totalCounted: number;
}

// ---------- Подключения источников тренировок ----------

export interface IntegrationInfo {
  provider: string;
  /** active — работает; reauth_required — доступ отозван или истёк, нужно подключить заново. */
  status: 'active' | 'reauth_required' | 'disabled';
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

export type HubProvider = 'hae' | 'health_connect';

/** Телефонный хаб: приложение на телефоне шлёт тренировки на личный адрес с токеном. */
export interface HubInfo {
  provider: HubProvider;
  url: string;
  /** null, пока человек не нажал «Подключить». */
  token: string | null;
  lastEventAt: string | null;
}

export interface IntegrationsResponse {
  /** Что настроено на сервере: без ключей приложения провайдер не показывается. */
  available: { whoop: boolean };
  connected: IntegrationInfo[];
  hubs: HubInfo[];
}
