// Real-time Notification System with Toast & Pop-ups
// This file handles real-time notifications like WhatsApp

const NotificationManager = {
  socket: null,
  userId: null,
  soundEnabled: true,
  
  init(socket, userId) {
    this.socket = socket;
    this.userId = userId;
    
    // Create notification container if it doesn't exist
    this.createNotificationContainer();
    
    // Load user preferences
    this.loadPreferences();
    
    // Listen for real-time notifications
    this.setupSocketListeners();
  },

  createNotificationContainer() {
    if (document.getElementById('notification-container')) return;
    
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
    
    // Add CSS for animations
    this.addNotificationStyles();
  },

  addNotificationStyles() {
    if (document.getElementById('notification-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .notification-toast {
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        padding: 16px 20px;
        min-width: 300px;
        max-width: 400px;
        animation: slideInRight 0.4s ease-out;
        pointer-events: auto;
        cursor: pointer;
        border-left: 5px solid #667eea;
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      
      .notification-toast.removing {
        animation: slideOutRight 0.3s ease-in forwards;
      }
      
      .notification-toast.success {
        border-left-color: #10b981;
      }
      
      .notification-toast.error {
        border-left-color: #ef4444;
      }
      
      .notification-toast.info {
        border-left-color: #3b82f6;
      }
      
      .notification-toast.warning {
        border-left-color: #f59e0b;
      }
      
      .notification-toast.login {
        border-left-color: #667eea;
        background: linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%);
      }
      
      .notification-toast.news {
        border-left-color: #f093fb;
      }
      
      .notification-toast.publication {
        border-left-color: #4facfe;
      }
      
      .notification-toast.book-update {
        border-left-color: #fa709a;
        animation: slideInRight 0.4s ease-out, pulse 2s infinite;
      }
      
      .notification-icon {
        font-size: 24px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
      }
      
      .notification-content {
        flex: 1;
      }
      
      .notification-title {
        font-weight: 600;
        font-size: 15px;
        color: #1f2937;
        margin-bottom: 4px;
      }
      
      .notification-message {
        font-size: 14px;
        color: #6b7280;
        line-height: 1.4;
      }
      
      .notification-time {
        font-size: 12px;
        color: #9ca3af;
        margin-top: 4px;
      }
      
      .notification-close {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 18px;
        color: #d1d5db;
        padding: 0;
        flex-shrink: 0;
        transition: color 0.2s;
      }
      
      .notification-close:hover {
        color: #6b7280;
      }
      
      .notification-action {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #e5e7eb;
      }
      
      .notification-btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .notification-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .notification-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        animation: progress 5s linear forwards;
      }
      
      @keyframes progress {
        from { width: 100%; }
        to { width: 0%; }
      }
    `;
    document.head.appendChild(style);
  },

  showNotification(data) {
    const {
      type = 'info',
      title,
      message,
      icon = this.getIcon(type),
      duration = 5000,
      action = null,
      sound = true
    } = data;

    const container = document.getElementById('notification-container');
    
    const notification = document.createElement('div');
    notification.className = `notification-toast ${type}`;
    
    const timeStr = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });

    notification.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
        <div class="notification-time">${timeStr}</div>
        ${action ? `<div class="notification-action"><button class="notification-btn" onclick="${action.callback}">${action.text}</button></div>` : ''}
      </div>
      <button class="notification-close">&times;</button>
      <div class="notification-progress"></div>
    `;

    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => this.removeNotification(notification));

    container.appendChild(notification);

    // Play sound if enabled
    if (sound && this.soundEnabled) {
      this.playSound(type);
    }

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => this.removeNotification(notification), duration);
    }

    return notification;
  },

  removeNotification(element) {
    element.classList.add('removing');
    setTimeout(() => {
      element.remove();
    }, 300);
  },

  getIcon(type) {
    const icons = {
      info: '🔔',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      login: '🔐',
      news: '📰',
      publication: '📚',
      'book-update': '📖',
      comment: '💬',
      message: '✉️'
    };
    return icons[type] || '🔔';
  },

  playSound(type) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      let frequency = 800;
      let duration = 200;
      
      switch(type) {
        case 'success':
          frequency = 1000;
          duration = 150;
          break;
        case 'error':
          frequency = 400;
          duration = 250;
          break;
        case 'login':
          frequency = 800;
          duration = 300;
          break;
        case 'book-update':
          frequency = 900;
          duration = 200;
          break;
      }
      
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      envelope.setValueAtTime(0.3, audioContext.currentTime);
      envelope.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
      
      oscillator.connect(envelope);
      envelope.connect(audioContext.destination);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (e) {
      console.log('Audio notification not available');
    }
  },

  setupSocketListeners() {
    if (!this.socket) return;

    // Real-time in-app notification
    this.socket.on('notificationAlert', (data) => {
      console.log('Notification received:', data);
      this.showNotification({
        type: data.type || 'info',
        title: data.title,
        message: data.message,
        duration: data.duration || 5000,
        sound: true
      });
      
      // Update unread count
      this.updateUnreadCount();
    });

    // Login alert
    this.socket.on('loginAlert', (data) => {
      this.showNotification({
        type: 'login',
        title: '🔐 New Login Detected',
        message: `Login from ${data.device || 'Unknown Device'} at ${new Date().toLocaleTimeString()}`,
        duration: 8000,
        sound: true,
        action: {
          text: 'View Details',
          callback: `window.location.href='/account'`
        }
      });
    });

    // News update
    this.socket.on('newsAlert', (data) => {
      this.showNotification({
        type: 'news',
        title: '📰 News Update',
        message: data.title,
        duration: 6000,
        sound: true,
        action: {
          text: 'Read News',
          callback: `window.location.href='/news'`
        }
      });
    });

    // Publication update
    this.socket.on('publicationAlert', (data) => {
      this.showNotification({
        type: 'publication',
        title: '📚 New Publication',
        message: `${data.author} published: ${data.title}`,
        duration: 6000,
        sound: true,
        action: {
          text: 'View',
          callback: `window.location.href='/publications'`
        }
      });
    });

    // Book update alert - MOST IMPORTANT
    this.socket.on('bookUpdate', (data) => {
      this.showNotification({
        type: 'book-update',
        title: '📖 Book Updated',
        message: `"${data.bookTitle}" by ${data.author} has been updated with new content!`,
        duration: 7000,
        sound: true,
        action: {
          text: 'Check It Out',
          callback: `window.open('/publications/${data.publicationId}', '_blank')`
        }
      });
    });

    // Comment notification
    this.socket.on('commentNotification', (data) => {
      this.showNotification({
        type: 'comment',
        title: '💬 New Comment',
        message: `${data.author} commented on your publication`,
        duration: 5000,
        sound: true
      });
    });

    // Private message notification
    this.socket.on('privateMessage', (data) => {
      this.showNotification({
        type: 'message',
        title: '✉️ New Message',
        message: `${data.senderName}: ${data.content.substring(0, 50)}...`,
        duration: 5000,
        sound: true,
        action: {
          text: 'Reply',
          callback: `window.location.href='/messages'`
        }
      });
    });
  },

  updateUnreadCount() {
    // This will be called to update the notification badge
    fetch('/notifications/unread-count')
      .then(res => res.json())
      .then(data => {
        const badge = document.querySelector('[data-notification-badge]');
        if (badge) {
          badge.textContent = data.count;
          badge.style.display = data.count > 0 ? 'flex' : 'none';
        }
      })
      .catch(err => console.error('Error updating unread count:', err));
  },

  loadPreferences() {
    fetch('/notifications/preferences')
      .then(res => res.json())
      .then(data => {
        this.soundEnabled = data.preferences.soundNotifications !== false;
      })
      .catch(err => console.error('Error loading preferences:', err));
  },

  // Request browser notification permission
  requestBrowserPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Browser notification permission:', permission);
      });
    }
  },

  // Show browser notification
  showBrowserNotification(title, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
      return new Notification(title, {
        icon: '/images/bookhive-icon.png',
        badge: '/images/notification-badge.png',
        ...options
      });
    }
  }
};

// Initialize when socket is ready
if (typeof io !== 'undefined') {
  const socket = io();
  
  socket.on('connect', () => {
    const userId = document.querySelector('[data-user-id]')?.getAttribute('data-user-id');
    if (userId) {
      NotificationManager.init(socket, userId);
      NotificationManager.requestBrowserPermission();
    }
  });
}
