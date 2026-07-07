import { NextResponse } from "next/server";
import { z } from "zod";
import { traceCapsuleSchema } from "@/lib/capsules/schema";
import { createSynapseClient } from "@/lib/filecoin/client";
import { downloadJsonPayload } from "@/lib/filecoin/json-storage";

export const runtime = "nodejs";

const requestSchema = z.object({
  pieceCid: z.string().trim().min(1)
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const synapse = createSynapseClient();
    const downloaded = await downloadJsonPayload(synapse, body.pieceCid);
    const capsule = traceCapsuleSchema.parse(downloaded.value);

    return NextResponse.json({
      ok: true,
      pieceCid: body.pieceCid,
      size: downloaded.size,
      capsule,
      rawJson: downloaded.text
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
