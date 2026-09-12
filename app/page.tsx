import { auth } from "@/auth";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingPage } from "@/components/landing/landing-page";

export default async function Home() {
  const session = await auth();
  const currentUser = session?.user ?? null;
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <I18nProvider initialLocale="zh">
      <LandingPage
        isAuthenticated={isAuthenticated}
        currentUser={currentUser}
      />
    </I18nProvider>
  );
}

