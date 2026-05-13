import { NextResponse } from "next/server";

import { Prisma } from "@prisma/client";
import { recordAuthAudit } from "@/lib/auth-audit";

export function isTransientDatabaseError(error: unknown): boolean {
  // P2024: Timed out fetching a new connection from the connection pool
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2024";
  }

  // P1001: Can't reach database server
  // P1002: Database server closed the connection
  // P1008: Operations timed out
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return (
      error.errorCode === "P1001" ||
      error.errorCode === "P1002" ||
      error.errorCode === "P1008"
    );
  }

  return false;
}

type AuthAuditAction = Parameters<typeof recordAuthAudit>[0]["action"];
type AuthRequestMeta = Pick<Parameters<typeof recordAuthAudit>[0], "ipAddress" | "userAgent">;

type UnhandledAuthErrorOptions = {
  logMessage: string;
  auditFailureLogMessage: string;
  unknownMessage?: string;
  auditDetail?: (message: string) => string;
  auditUserId?: number | null;
  auditEmail?: string | null;
  response?: (message: string, error: unknown) => {
    status: number;
    error: string;
  };
};

export async function handleUnhandledAuthError(
  error: unknown,
  requestMeta: AuthRequestMeta,
  action: AuthAuditAction,
  options: UnhandledAuthErrorOptions,
) {
  console.error(options.logMessage, error);

  const message = error instanceof Error
    ? error.message
    : (options.unknownMessage ?? "Unknown error");

  try {
    await recordAuthAudit({
      action,
      success: false,
      email: options.auditEmail,
      userId: options.auditUserId,
      detail: options.auditDetail ? options.auditDetail(message) : `Unhandled ${action} error: ${message}`,
      ...requestMeta,
    });
  } catch (auditError) {
    console.error(options.auditFailureLogMessage, auditError);
  }

  const response = options.response
    ? options.response(message, error)
    : {
      status: 500,
      error: process.env.NODE_ENV === "development" ? message : "Internal server error",
    };

  return NextResponse.json(
    {
      error: response.error,
    },
    { status: response.status },
  );
}
