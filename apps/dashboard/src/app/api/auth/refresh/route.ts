import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const API_PATH = process.env.NEXT_PUBLIC_API_PATH ?? "/api/v1";
const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID;
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
    response = await fetch(
      `${API_URL}${API_PATH}/identity/sso/tokens/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(body.token ? { Authorization: `Bearer ${body.token}` } : {}),
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: body.refresh_token,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Upstream service unavailable" },
      { status: 502 }
    );
  }

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
