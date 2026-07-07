import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Server-side Filecoin private keys are disabled. Use the Connect MetaMask button in the browser."
    },
    { status: 410 }
  );
}
