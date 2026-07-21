
import { NextRequest, NextResponse } from "next/server";

const env = (value: string | undefined, fallback: string) =>
  value && value.trim() !== "" ? value : fallback;

const API_URL = env(process.env.NEXT_PUBLIC_API_URL, "https://go.vocostar.com");
const CLIENT_ID = env(process.env.NEXT_PUBLIC_CLIENT_ID, "opengrow-vocostar");
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

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
