// ============================================================
// Logger — Logging ke file + console (error only)
// ============================================================

import winston from 'winston';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'base-scalping-bot' },
  transports: [
    // Console: cuma error biar output user bersih
    new winston.transports.Console({
      level: 'error',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level}]: ${message}`
        )
      ),
    }),
    // File: error aja
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    // File: semua log
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

export function createContextLogger(context: string): winston.Logger {
  return logger.child({ context });
}

export default logger;
