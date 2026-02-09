import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { oauthAccounts, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const credentialsSchema = z.object({
  mode: z.enum(["signIn", "signUp"]),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}

async function ensureOAuthUser(params: {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}) {
  const [linked] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, params.provider),
        eq(oauthAccounts.providerAccountId, params.providerAccountId),
      ),
    )
    .limit(1);

  if (linked?.userId) {
    return linked.userId;
  }

  const normalizedEmail = params.email
    ? normalizeEmail(params.email)
    : `${params.provider}-${params.providerAccountId}@oauth.seconda.local`;

  let user = await findUserByEmail(normalizedEmail);

  if (!user) {
    const userId = randomUUID();
    const [createdUser] = await db
      .insert(users)
      .values({
        id: userId,
        email: normalizedEmail,
        name: params.name ?? null,
        image: params.image ?? null,
      })
      .returning();

    user = createdUser;
  } else {
    await db
      .update(users)
      .set({
        name: params.name ?? user.name,
        image: params.image ?? user.image,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  }

  await db
    .insert(oauthAccounts)
    .values({
      id: randomUUID(),
      userId: user.id,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
    })
    .onConflictDoNothing();

  return user.id;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  providers: [
    GitHub({}),
    Google({}),
    Credentials({
      credentials: {
        mode: { label: "Mode", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Name", type: "text" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const { mode, password } = parsed.data;
        const email = normalizeEmail(parsed.data.email);
        const name = parsed.data.name?.trim() || null;

        if (mode === "signUp") {
          const passwordHash = hashPassword(password);
          const existingUser = await findUserByEmail(email);

          if (existingUser?.passwordHash) {
            return null;
          }

          if (existingUser) {
            const [updatedUser] = await db
              .update(users)
              .set({
                passwordHash,
                name: name ?? existingUser.name,
                updatedAt: new Date(),
              })
              .where(eq(users.id, existingUser.id))
              .returning();

            return {
              id: updatedUser.id,
              email: updatedUser.email,
              name: updatedUser.name,
            };
          }

          const userId = randomUUID();
          const [createdUser] = await db
            .insert(users)
            .values({
              id: userId,
              email,
              name,
              passwordHash,
            })
            .returning();

          return {
            id: createdUser.id,
            email: createdUser.email,
            name: createdUser.name,
          };
        }

        const user = await findUserByEmail(email);
        if (!user?.passwordHash) {
          return null;
        }

        const isValidPassword = verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account) {
        return false;
      }

      if (account.provider === "credentials") {
        return Boolean(user.id);
      }

      if (account.provider !== "github" && account.provider !== "google") {
        return false;
      }

      if (!account.providerAccountId) {
        return false;
      }

      const resolvedUserId = await ensureOAuthUser({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: user.email,
        name: user.name,
        image: user.image,
      });

      if (!resolvedUserId) {
        return false;
      }

      user.id = resolvedUserId;
      return true;
    },
    async jwt({ token, user }) {
      const authToken = token as typeof token & { userId?: string };

      if (user?.id) {
        authToken.userId = user.id;
        authToken.sub = user.id;
      }

      if (!authToken.userId && typeof authToken.sub === "string") {
        authToken.userId = authToken.sub;
      }

      return authToken;
    },
    async session({ session, token }) {
      const userId = (token as { userId?: string }).userId;
      if (session.user && userId) {
        session.user.id = userId;
      }
      return session;
    },
  },
});
