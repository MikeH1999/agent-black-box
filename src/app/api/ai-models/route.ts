import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url()
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const response = await fetch(getModelsEndpoint(parsed.data.baseUrl), {
    headers: {
      Authorization: `Bearer ${parsed.data.apiKey}`
    }
  });
  const data = (await response.json()) as { data?: Array<{ id?: string }>; error?: unknown };

  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? data }, { status: response.status });
  }

  return NextResponse.json({
    models: (data.data ?? []).map((model) => model.id).filter((id): id is string => typeof id === "string")
  });
}

function getModelsEndpoint(baseUrl: string) {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${cleanBaseUrl}/models`;
}
