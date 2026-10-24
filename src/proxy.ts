import { NextResponse, type NextRequest } from "next/server";
import { isOperatorAuthorized } from "./ops/auth";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  const english = pathname === "/en" || pathname.startsWith("/en/");
  requestHeaders.set("x-evryvibe-locale", english ? "en" : "de");

  if (pathname === "/ops" || pathname.startsWith("/ops/")) {
    if (
      !isOperatorAuthorized(
        request.headers.get("authorization"),
        process.env.EVRYVIBE_OPERATOR_PASSWORD,
      )
    ) {
      return new NextResponse("Operator authentication required.", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Basic realm="EVRYVIBE operator", charset="UTF-8"',
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  // Rewrite only public catalogue pages. Localized aliases must never expose ops/API.
  if (
    english &&
    /^\/en(?:\/?|\/(?:impressum|datenschutz|kontakt|takedown|cities|djs|genres)\/?|\/(?:events|venues|djs|cities|genres)\/[^/]+\/?|\/cities\/[^/]+\/\d{4}-(?:0[1-9]|1[0-2])\/?)$/.test(
      pathname,
    )
  ) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.slice(3) || "/";
    return NextResponse.rewrite(destination, {
      request: { headers: requestHeaders },
    });
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/ops/:path*",
    "/((?!api|_next|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
