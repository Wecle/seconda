import { auth } from "@/auth";
import { LandingPage } from "@/components/landing/landing-page";

export default async function Home() {
  const session = await auth();
  const currentUser = session?.user ?? null;
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      currentUser={currentUser}
    />
  );
}
