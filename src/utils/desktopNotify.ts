// OS-level desktop notification for a new qualifying RFQ, as an alternative
// to the in-panel toast. Requires a one-time browser permission grant —
// browsers only honor requestPermission() when it's called from a genuine
// user gesture (a click), so that must happen from a button handler, not
// automatically when data loads.
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') {
    return Promise.resolve('denied');
  }
  return Notification.requestPermission();
}

// Only shows if permission has already been granted — never itself
// prompts, so it's safe to call from a background effect. Returns whether
// it actually showed a notification, so callers can fall back (e.g. to an
// in-panel toast) when it didn't.
export function showDesktopNotification(title: string, body: string, onClick?: () => void): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }
  const notification = new Notification(title, { body });
  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }
  return true;
}
