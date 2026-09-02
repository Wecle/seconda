import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function getCurrentUserId() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  try {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return existingUser?.id ?? null;
  } catch {
    return null;
  }
}
