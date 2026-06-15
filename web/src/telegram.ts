interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  MainButton: { hide: () => void };
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (t: string) => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = window.Telegram?.WebApp;

export function initTelegram(): void {
  try {
    tg?.ready();
    tg?.expand();
  } catch {
    /* вне Telegram — игнорируем */
  }
}

export function getInitData(): string {
  return tg?.initData ?? '';
}

export function haptic(type: 'success' | 'error' | 'warning' = 'success'): void {
  try {
    tg?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* ignore */
  }
}
