import winston from 'winston';
import path from 'path';
import { config } from '../config';

export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        level: config.server.port === 3001 ? 'debug' : 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ];

    // Add file transport if log file is configured
    if (process.env.LOG_FILE) {
      transports.push(
        new winston.transports.File({
          filename: path.resolve(process.env.LOG_FILE),
          level: process.env.LOG_LEVEL || 'info',
          format: logFormat,
          maxsize: parseInt(process.env.LOG_MAX_SIZE || '10485760'), // 10MB
          maxFiles: parseInt(process.env.LOG_MAX_FILES || '5')
        })
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports
    });
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public error(message: string, error?: Error | any): void {
    this.logger.error(message, { error: error?.message || error, stack: error?.stack });
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public performance(operation: string, duration: number, meta?: any): void {
    this.logger.info(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...meta
    });
  }
}

export const logger = Logger.getInstance();