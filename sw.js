/* ═══════════════════════════════════════════════
   ИнвестГид — Service Worker v1.0
   Что делает:
   1. Кэширует приложение → работает офлайн
   2. Обновляет кэш когда есть интернет
   3. Показывает push-уведомления
═══════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────
   НАСТРОЙКА ПУТЕЙ
   Если сайт в подпапке (например GitHub Pages):
     BASE_PATH = '/investgid'  ← имя репозитория
   Если в корне домена (например investgid.ru):
     BASE_PATH = ''
   ─────────────────────────────────────────────── */
const BASE_PATH = '/investgid';
const CACHE_NAME = 'investgid-v2';

const CACHE_FILES = [
  BASE_PATH + '/',
  BASE_PATH + '/index.html',
  BASE_PATH + '/manifest.json'
];

/* ─── 1. УСТАНОВКА: кэшируем файлы ─── */
self.addEventListener('install', function(event) {
  console.log('[SW] Установка...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Кэшируем файлы приложения');
      return cache.addAll(CACHE_FILES);
    }).then(function() {
      // Сразу активируем, не ждём закрытия вкладок
      return self.skipWaiting();
    })
  );
});

/* ─── 2. АКТИВАЦИЯ: удаляем старые кэши ─── */
self.addEventListener('activate', function(event) {
  console.log('[SW] Активация...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Удаляем все кэши кроме текущего
          return key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[SW] Удаляем старый кэш:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      // Берём управление всеми вкладками сразу
      return self.clients.claim();
    })
  );
});

/* ─── 3. ПЕРЕХВАТ ЗАПРОСОВ: офлайн-стратегия ─── */
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // API-запросы к Anthropic — только через сеть, не кэшируем
  if (url.includes('api.anthropic.com')) {
    return; // пропускаем, SW не вмешивается
  }

  // Всё остальное: сначала пробуем сеть, при ошибке — кэш
  event.respondWith(
    fetch(event.request)
      .then(function(networkResponse) {
        // Запрос прошёл — обновляем кэш свежей версией
        if (networkResponse && networkResponse.status === 200) {
          var responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(function() {
        // Нет интернета — достаём из кэша
        return caches.match(event.request).then(function(cached) {
          if (cached) {
            console.log('[SW] Офлайн — отдаём из кэша:', url);
            return cached;
          }
          // Ни сети, ни кэша — возвращаем офлайн-страницу
          return caches.match('/index.html');
        });
      })
  );
});

/* ─── 4. PUSH-УВЕДОМЛЕНИЯ ─── */
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'ИнвестГид', body: event.data ? event.data.text() : '' };
  }

  var title = data.title || 'ИнвестГид';
  var options = {
    body: data.body || 'Новое уведомление',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'investgid',
    data: { url: data.url || '/' },
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ─── 5. КЛИК ПО УВЕДОМЛЕНИЮ ─── */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Если приложение уже открыто — фокусируем вкладку
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        // Иначе открываем новую вкладку
        return clients.openWindow(targetUrl);
      })
  );
});

/* ─── 6. СООБЩЕНИЯ ОТ СТРАНИЦЫ ─── */
// Страница может управлять SW через postMessage
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
