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

export interface DayStatusRow {
  participationId: number;
  name: string;
  state: DayState;
}
