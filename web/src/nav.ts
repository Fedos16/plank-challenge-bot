import { ref } from 'vue';

/**
 * Чей профиль открыт поверх текущего экрана. Открывают его из глубины (рейтинг, лента),
 * поэтому состояние общее, а не пробрасывается событиями через все экраны. Экран под ним
 * не размонтируется: закрыли профиль — вернулись туда же, на ту же вкладку.
 */
export const viewedUserId = ref<number | null>(null);

let scrollBefore = 0;

export function openUserProfile(userId: number): void {
  if (viewedUserId.value === null) scrollBefore = window.scrollY;
  viewedUserId.value = userId;
  window.scrollTo(0, 0);
}

export function closeUserProfile(): void {
  viewedUserId.value = null;
  // экран под профилем снова виден только после перерисовки — тогда и возвращаем прокрутку
  requestAnimationFrame(() => window.scrollTo(0, scrollBefore));
}
