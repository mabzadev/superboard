
import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "../rateLimit";

const env = (value: string | undefined, fallback: string) =>
  value && value.trim() !== "" ? value : fallback;

const API_URL = env(process.env.NEXT_PUBLIC_API_URL, "https://go.vocostar.com");
const CLIENT_ID = env(process.env.NEXT_PUBLIC_CLIENT_ID, "opengrow-vocostar");
const CLIENT_SECRET = process.env.CLIENT_SECRET;

export async function POST(request: NextRequest) {
  try {
    if (!CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    if (
      typeof body.email !== "string" ||
      !body.email ||
      typeof body.password !== "string" ||
      !body.password
    ) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(`${API_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "password",
          email: body.email,
          password: body.password,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          ...(body.otp_code ? { otp_code: body.otp_code } : {}),
        }),
      });
    } catch {
      return NextResponse.json(
        { error: "Upstream service unavailable" },
        { status: 502 }
      );
    }

    const tokenData = (await tokenResponse.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!tokenResponse.ok || !tokenData.access_token) {
      return NextResponse.json(tokenData, { status: tokenResponse.status });
    }

    let user: Record<string, unknown> | null = null;
    try {
      const meResponse = await fetch(`${API_URL}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (meResponse.ok) {
        const meData = (await meResponse.json()) as {
          user?: Record<string, unknown>;
        };
        user = meData.user ?? null;
      }
    } catch {
      user = null;
    }

    return NextResponse.json({ ...tokenData, user }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "Authentication proxy failed", detail: String(error) },
      { status: 500 }
    );
  }
}
