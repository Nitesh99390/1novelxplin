# Бей БОССА! — Telegram Mini App (frontend)

Кликер-игра «Бей босса» для Telegram Mini Apps. Сейчас это **только фронтенд**
(состояние хранится в `localStorage`), бэкенд будет добавлен позже.

## Запуск

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## Деплой на Render

Репозиторий содержит `render.yaml` — просто подключите репо в Render (Blueprint)
или создайте Web Service: `npm ci` / `npm start`, health check `/api/health`.
Затем укажите URL сервиса в BotFather → Bot Settings → Menu Button / Web App.

## Структура

- `server.js` — статический сервер Express (+ `/api/health`, `/vendor/confetti.js`)
- `public/index.html`, `style.css`, `app.js` — весь UI и анимации
- `public/assets/` — 3D-иконки (Fluent Emoji, MIT)

## Open-source ресурсы

- Шрифт [Nunito](https://fonts.google.com/specimen/Nunito) — OFL
- Иконки [Fluent Emoji 3D](https://github.com/microsoft/fluentui-emoji) — MIT
- [canvas-confetti](https://github.com/catdad/canvas-confetti) — ISC
- Telegram WebApp SDK — `telegram-web-app.js`

## Подключение бэкенда (позже)

В `public/app.js` помечены точки интеграции: `load()/save()` (состояние),
`onHit()` (удар), `window.CLAIM_URL` (ссылка «Забрать звёзды»).
