import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, localeCookieName } from "./lib/i18n";

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 确定当前路由语言
  const isEnRoute = pathname === "/en" || pathname.startsWith("/en/");
  const currentLocale = isEnRoute ? "en" : defaultLocale;

  // 4. 注入 x-locale 标头供 Server Component (layout.tsx 等) 读取
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-locale", currentLocale);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // 5. 访问 /en 时同步写入语言 Cookie，便于后续进入 dashboard 保持英文
  if (isEnRoute) {
    response.cookies.set(localeCookieName, "en", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 匹配除以下开头的路径：
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, logo.png 等具有文件后缀的静态资源
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
