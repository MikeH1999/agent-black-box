import { NextResponse } from "next/server";
import { z } from "zod";
import { readLocalState, writeLocalState } from "@/lib/local-state";

const modelSchema = z.object({
  id: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  createdAt: z.string().min(1)
});

const stateSchema = z.object({
  configs: z.array(modelSchema),
  activeConfigId: z.string().nullable()
});

export async function GET() {
  const state = await readLocalState();
  return NextResponse.json(state.aiModels);
}

export async function POST(request: Request) {
  const parsed = stateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const state = await readLocalState();
  state.aiModels = parsed.data;
  await writeLocalState(state);

  return NextResponse.json({ ok: true });
}
