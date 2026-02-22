import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation Error",
      code: "VALIDATION_ERROR",
      details: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Unknown errors
  console.error("Unhandled error:", err);
  res.status(500).json({
    error:
      env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    code: "INTERNAL_ERROR",
  });
}
