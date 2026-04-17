/**
 * Native browser Notification helpers.
 * Notifications appear even when the tab is in the background,
 * so users get alerted while working in another window.
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Request permission if not already decided. Returns current permission. */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'default') {
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }
  return Notification.permission;
}

export interface NotifyOptions {
  title: string;
  body: string;
  icon?: string;
  onClick?: () => void;
}

/** Fire a native notification. Silently no-op if not permitted. */
export function notify({ title, body, icon, onClick }: NotifyOptions): Notification | null {
  if (!notificationsSupported()) return null;
  if (Notification.permission !== 'granted') return null;
  try {
    const n = new Notification(title, {
      body: body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      icon: icon || '/entrasp/images/logos/logo_box.png',
      // No `tag`: each banner stacks as its own notification.
      // With a shared tag, each new notification would replace the previous.
    });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    return n;
  } catch {
    return null;
  }
}
