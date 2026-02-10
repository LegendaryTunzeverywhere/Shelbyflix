import { useState, useCallback } from 'react';
import type { Notification, NotificationType } from '@/types';

/**
 * Custom hook for managing toast notifications
 */
export function useNotification() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const show = useCallback((
    message: string,
    type: NotificationType = 'info',
    duration: number = 5000
  ) => {
    const id = `notification_${Date.now()}_${Math.random()}`;
    const notification: Notification = { id, message, type, duration };

    setNotifications((prev) => [...prev, notification]);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const success = useCallback((message: string, duration?: number) => {
    return show(message, 'success', duration);
  }, [show]);

  const error = useCallback((message: string, duration?: number) => {
    return show(message, 'error', duration);
  }, [show]);

  const info = useCallback((message: string, duration?: number) => {
    return show(message, 'info', duration);
  }, [show]);

  const warning = useCallback((message: string, duration?: number) => {
    return show(message, 'warning', duration);
  }, [show]);

  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    show,
    success,
    error,
    info,
    warning,
    remove,
    clear,
  };
}

export default useNotification;
