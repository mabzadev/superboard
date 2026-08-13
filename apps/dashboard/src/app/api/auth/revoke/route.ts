
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

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid token" },
      { status: 400 }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: body.token,
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

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
