// proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const aliasMap: Record<string, string> = {
  "/new-password": "/new_password",
  "/links": "/dynamic_links/links",
  "/settings/subscription": "/settings",
  // add more one-to-one aliases here
};

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const { pathname } = url;

  // direct match
  if (aliasMap[pathname]) {
    const to = new URL(url);
    to.pathname = aliasMap[pathname];
    return NextResponse.redirect(to, 308);
  }

  // optional: also handle nested paths like /user-profile/123/edit
  for (const [from, toPath] of Object.entries(aliasMap)) {
    if (pathname.startsWith(from + "/")) {
      const rest = pathname.slice(from.length); // keeps "/123/edit"
      const to = new URL(url);
      to.pathname = toPath + rest;
      return NextResponse.redirect(to, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|.*\\.(?:png|jpg|jpeg|svg|ico|txt|xml)).*)"],
};
