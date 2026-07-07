import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreTraceChain } from "@/lib/agent/restore";
import { createSynapseClient } from "@/lib/filecoin/client";

export const runtime = "nodejs";

const requestSchema = z.object({
  pieceCid: z.string().trim().min(1)
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const synapse = createSynapseClient();
    const restoredCapsules = await restoreTraceChain(synapse, body.pieceCid);

    return NextResponse.json({
      ok: true,
      restoredCapsules
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
