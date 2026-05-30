export class CiLogger {
  static info(message: string, meta?: any) {
    console.log(`[CI INFO] ${message}`, meta || '');
  }

  static error(message: string, meta?: any) {
    console.error(`[CI ERROR] ${message}`, meta || '');
  }
}