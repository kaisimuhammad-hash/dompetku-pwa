export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export function badRequest(message) {
  return new AppError(message, 400);
}

export function notFound(message = 'Data tidak ditemukan') {
  return new AppError(message, 404);
}

export function unauthorized(message = 'Silakan masuk terlebih dahulu') {
  return new AppError(message, 401);
}
