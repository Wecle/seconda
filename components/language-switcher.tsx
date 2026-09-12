"use client";

import { usePathname, useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { locales, localeNames, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();

  const handleSelect = (targetLocale: Locale) => {
    if (targetLocale === locale) {
      return;
    }

    setLocale(targetLocale);

    if (targetLocale === "en") {
      if (pathname === "/") {
        router.push("/en");
      }
    } else if (targetLocale === "zh") {
      if (pathname === "/en") {
        router.push("/");
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => handleSelect(l)}
            className={locale === l ? "font-medium text-primary" : ""}
          >
            {localeNames[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
