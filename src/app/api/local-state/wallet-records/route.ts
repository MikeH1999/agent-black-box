import { NextResponse } from "next/server";
import { z } from "zod";
import { readLocalState, writeLocalState } from "@/lib/local-state";

const recordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  note: z.string(),
  pieceCid: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  uploadedAt: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative()
});

const recordsSchema = z.object({
  wallet: z.string().min(1),
  records: z.array(recordSchema)
});

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase();
  if (wallet == null || wallet.length === 0) {
    return NextResponse.json({ error: "Missing wallet." }, { status: 400 });
  }

  const state = await readLocalState();
  return NextResponse.json({ records: state.walletRecords[wallet] ?? [] });
}

export async function POST(request: Request) {
  const parsed = recordsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const wallet = parsed.data.wallet.toLowerCase();
  const state = await readLocalState();
  state.walletRecords[wallet] = parsed.data.records;
  await writeLocalState(state);

  return NextResponse.json({ ok: true });
}
