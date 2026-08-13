
import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "../rateLimit";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET;

export async function POST(request: NextRequest) {
  try {
    if (!API_URL || !CLIENT_ID || !CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    const ip =
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
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
    if (body.otp_code !== undefined && typeof body.otp_code !== "string") {
      return NextResponse.json(
        { error: "OTP code must be a string" },
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

    if (!tokenResponse.ok) {
      return NextResponse.json(tokenData, { status: tokenResponse.status });
    }
    if (
      typeof tokenData.access_token !== "string" ||
      !tokenData.access_token
    ) {
      return NextResponse.json(
        { error: "Authentication service returned an invalid response" },
        { status: 502 }
      );
    }

    let meResponse: Response;
    try {
      meResponse = await fetch(`${API_URL}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
    } catch {
      return NextResponse.json(
        { error: "Unable to load authenticated user" },
        { status: 502 }
      );
    }

    const meData = (await meResponse.json().catch(() => ({}))) as {
      user?: unknown;
    };
    if (
      !meResponse.ok ||
      !meData.user ||
      typeof meData.user !== "object" ||
      Array.isArray(meData.user)
    ) {
      return NextResponse.json(
        { error: "Unable to load authenticated user" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { ...tokenData, user: meData.user },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Authentication proxy failed" },
      { status: 500 }
    );
  }
}
