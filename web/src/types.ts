export interface ChallengePublic {
  id: number;
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
  bank: number;
}

export type DayState = 'done' | 'late' | 'fake' | 'rejected' | 'sick' | 'missed' | 'pending';

export interface MyChallenge {
  id: number;
  key: string;
  title: string;
  description: string;
  dayNumber: number;
  todayState: DayState;
  currentStreak: number;
  bank: number;
}

export interface MyChallengesResponse {
  user: { name: string; username: string | null; photoUrl: string | null; isAdmin: boolean };
  challenges: MyChallenge[];
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
}

export interface RecentDayRow {
  participationId: number;
  name: string;
  status: string;
  state: DayState;
  submittedAt: string | null;
  videoDuration: number | null;
  fine: number;
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
