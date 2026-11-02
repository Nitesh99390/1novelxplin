// Минимальный статический сервер для Telegram Mini App «Бей БОССА!».
// Бэкенд (игровая логика, Telegram-бот, выплаты) будет добавлен позже —
// сейчас это только фронтенд, состояние хранится в localStorage на клиенте.
import express from 'express';
import { resolve } from 'node:path';

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Open-source библиотека конфетти (ISC) отдаётся из node_modules
app.get('/vendor/confetti.js', (_, res) =>
  res.sendFile(resolve('node_modules/canvas-confetti/dist/confetti.browser.js'))
);

app.use(express.static('public', { extensions: ['html'], maxAge: '1h' }));
app.get('*path', (_, res) => res.sendFile(resolve('public/index.html')));

app.listen(port, '0.0.0.0', () => console.log(`Бей БОССА! listening on ${port}`));
