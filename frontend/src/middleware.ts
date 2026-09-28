import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";

/** Routes that require an admin session cookie / JWT claim. */
const ADMIN_ONLY_PATHS = ["/docs/colors"];

/**
 * Routes that require any authenticated session (wallet connected + JWT).
 * Issue #1208: redirect unauthenticated users to `/` from these paths.
 */
const PROTECTED_PATHS = [
  "/dashboard",
  "/loans",
  "/collateral",
  "/transactions",
  "/profile",
  "/settings",
  "/borrow",
];

/**
 * Lightweight role check: reads the `role` field from the `session` cookie
 * (base-64 encoded JSON written by the backend on login). This mirrors the
 * pattern used for /admin/** routes. A full cryptographic JWT verification
 * happens inside the API layer — here we only need to gate the UI.
 */
function isAdminRequest(request: NextRequest): boolean {
  const session = request.cookies.get("session")?.value;
  if (!session) return false;
  try {
    const payload = JSON.parse(atob(session.split(".")[1] ?? ""));
    return payload?.role === "admin";
  } catch {
    return false;
  }
}

/**
 * Check whether the request carries a valid (non-expired) session cookie.
 * Issue #1208: gates protected routes for unauthenticated users.
 */
function isAuthenticated(request: NextRequest): boolean {
  const session = request.cookies.get("session")?.value;
  if (!session) return false;
  try {
    const parts = session.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload?.exp !== "number") return false;
    // Check token hasn't expired
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the maintenance page itself and static assets through
  if (
    MAINTENANCE &&
    pathname !== "/maintenance" &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/favicon")
  ) {
    return NextResponse.redirect(new URL("/maintenance", request.url));
  }

  // Issue #1208: redirect unauthenticated users away from protected routes
  if (
    PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    if (!isAuthenticated(request)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Restrict admin-only pages (#784)
  if (ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!isAdminRequest(request)) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
