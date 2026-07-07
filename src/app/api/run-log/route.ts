import { NextResponse } from "next/server";
import { readRecentRunLogs } from "@/lib/agent/run-log";

export const runtime = "nodejs";

export async function GET() {
  try {
    const runs = await readRecentRunLogs(10);

    return NextResponse.json({
      ok: true,
      runs
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
