import type { Prisma, PrismaClient } from "@prisma/client";

export type VerifiedUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    emailVerifiedAt: true;
    screenName: true;
    avatarUrl: true;
    bio: true;
    location: true;
  };
}>;

export type VerificationEmailUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    emailVerifiedAt: true;
  };
}>;

export type PrismaWithVerifiedUser = PrismaClient & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
        screenName: true;
        avatarUrl: true;
        bio: true;
        location: true;
      };
    }) => Promise<VerifiedUser | null>;
  };
};

export type PrismaWithVerificationEmailUser = PrismaClient & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
      };
    }) => Promise<VerificationEmailUser | null>;
  };
};

export type PrismaWithProfileUser = PrismaClient & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
        screenName: true;
        avatarUrl: true;
        bio: true;
        location: true;
      };
    }) => Promise<VerifiedUser | null>;
    update: (args: {
      where: { id: number };
      data: {
        screenName: string;
        avatarUrl: string | null;
        bio: string | null;
        location: string | null;
      };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
        screenName: true;
        avatarUrl: true;
        bio: true;
        location: true;
      };
    }) => Promise<VerifiedUser>;
  };
};

export type AuthSessionDelegate = {
  create: (args: {
    data: {
      userId: number;
      familyId: string;
      tokenHash: string;
      remember: boolean;
      expiresAt: Date;
    };
  }) => Promise<unknown>;
  findUnique: (args: {
    where: {
      tokenHash: string;
    };
  }) => Promise<{
    id: number;
    userId: number;
    familyId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    replacedByHash: string | null;
  } | null>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  update: (args: {
    where: {
      id: number;
    };
    data: {
      revokedAt: Date;
      replacedByHash: string;
    };
  }) => Promise<unknown>;
};

export type PrismaWithAuthSession = PrismaClient & {
  authSession: AuthSessionDelegate;
};

export type VerificationDelegate = {
  create: (args: { data: { userId: number; tokenHash: string; expiresAt: Date } }) => Promise<unknown>;
  findUnique: (args: { where: { tokenHash: string } }) => Promise<{
    id: number;
    userId: number;
    expiresAt: Date;
    consumedAt: Date | null;
  } | null>;
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
};

export type PasswordResetDelegate = VerificationDelegate;

export type UserDelegate = {
  update: (args: {
    where: { id: number };
    data: { emailVerifiedAt?: Date; passwordHash?: string };
  }) => Promise<unknown>;
};

export type PrismaWithTokenModels = PrismaClient & {
  emailVerificationToken: VerificationDelegate;
  passwordResetToken: PasswordResetDelegate;
  user: UserDelegate;
};

export type PrismaWithAuthAudit = PrismaClient & {
  authAuditLog: {
    create: (args: {
      data: {
        action: string;
        success: boolean;
        email: string | null;
        userId: number | null;
        ipAddress: string | null;
        userAgent: string | null;
        detail: string | null;
      };
    }) => Promise<unknown>;
  };
};
