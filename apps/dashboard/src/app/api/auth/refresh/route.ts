
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET;

export async function POST(request: NextRequest) {
  if (!API_URL || !CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
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
    typeof body.refresh_token !== "string" ||
    !body.refresh_token.trim()
  ) {
    return NextResponse.json(
      { error: "Missing or invalid refresh token" },
      { status: 400 }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: body.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream service unavailable" },
      { status: 502 }
    );
  }

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (
    response.ok &&
    (typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.refresh_token !== "string" ||
      !data.refresh_token)
  ) {
    return NextResponse.json(
      { error: "Authentication service returned an invalid response" },
      { status: 502 }
    );
  }
  return NextResponse.json(data, { status: response.status });
}
