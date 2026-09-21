interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  MainButton: { hide: () => void };
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (t: string) => void };
  showConfirm?: (message: string, callback: (ok: boolean) => void) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
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

/**
 * Открыть ссылку во внешнем браузере. Для OAuth это обязательно: внутри WebView Telegram
 * страница согласия провайдера не сможет вернуть пользователя обратно в приложение.
 */
export function openExternal(url: string): void {
  if (tg?.openLink) {
    try {
      tg.openLink(url);
      return;
    } catch {
      /* fallthrough */
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** Диалог подтверждения: нативный в Telegram, иначе window.confirm. */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.showConfirm) {
      try {
        tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
        return;
      } catch {
        /* fallthrough */
      }
    }
    resolve(window.confirm(message));
  });
}
