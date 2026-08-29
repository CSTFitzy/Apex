/**
 * Simple structured logging utility.
 *
 * Provides leveled logging with timestamps. In production this could be
 * swapped out for a more feature-complete library (e.g. winston/pino)
 * without changing call sites since it exposes the same interface.
 */

const LEVELS = ['error', 'warn', 'info', 'debug'];

const currentLevel = LEVELS.includes(process.env.LOG_LEVEL)
  ? process.env.LOG_LEVEL
  : 'info';

function shouldLog(level) {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(currentLevel);
}

function format(level, message, meta) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  return meta !== undefined ? `${base} ${JSON.stringify(meta)}` : base;
}

function log(level, message, meta) {
  if (!shouldLog(level)) return;
  const line = format(level, message, meta);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};

export default logger;
