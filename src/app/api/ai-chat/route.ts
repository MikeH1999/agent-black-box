import { NextResponse } from "next/server";
import { z } from "zod";

const imageSchema = z.object({
  name: z.string(),
  dataUrl: z.string()
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  images: z.array(imageSchema)
});

const requestSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1)
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const endpoint = getChatCompletionsEndpoint(parsed.data.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${parsed.data.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: parsed.data.model,
      messages: parsed.data.messages.map((message) => ({
        role: message.role,
        content:
          message.images.length === 0
            ? message.text
            : [
                { type: "text", text: message.text || "Please analyze the attached image." },
                ...message.images.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: image.dataUrl
                  }
                }))
              ]
      }))
    })
  });

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? data }, { status: response.status });
  }

  return NextResponse.json({
    answer: data.choices?.[0]?.message?.content ?? ""
  });
}

function getChatCompletionsEndpoint(baseUrl: string) {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  if (cleanBaseUrl.endsWith("/chat/completions")) {
    return cleanBaseUrl;
  }

  return `${cleanBaseUrl}/chat/completions`;
}
