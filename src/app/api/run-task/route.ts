import { NextResponse } from "next/server";
import { z } from "zod";
import type { SealedTraceCapsule } from "@/lib/agent/workflow";
import { runFixedAgentWorkflow } from "@/lib/agent/workflow";
import { appendRunLog } from "@/lib/agent/run-log";
import type { StoredRunLog } from "@/lib/agent/run-log";
import { createSynapseClient } from "@/lib/filecoin/client";

export const runtime = "nodejs";

const requestSchema = z.object({
  task: z.string().trim().min(1).max(1000),
  stream: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const synapse = createSynapseClient();

    if (body.stream === true) {
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          let isClosed = false;
          const send = (event: unknown) => {
            if (isClosed) {
              return;
            }
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          try {
            const runId = crypto.randomUUID();
            const onchainEvents: StoredRunLog["onchainEvents"] = [];
            send({ type: "status", status: "Preparing Filecoin storage" });
            const result = await runFixedAgentWorkflow(synapse, body.task, {
              returnAfter: "pieces-added",
              onUploadLifecycleEvent(event, capsule, index) {
                onchainEvents.push({
                  stepType: capsule.stepType,
                  event
                });
                send({
                  type: "upload-event",
                  index,
                  stepType: capsule.stepType,
                  event
                });
              },
              onCapsuleSealed(sealedCapsule: SealedTraceCapsule, index: number) {
                send({
                  type: "capsule-sealed",
                  index,
                  sealedCapsule
                });
              }
            });
            const runLog = await appendRunLog({
              runId,
              task: body.task,
              finalAnswer: result.finalAnswer,
              sealedCapsules: result.sealedCapsules,
              onchainEvents
            });

            send({
              type: "complete",
              runId,
              finalAnswer: result.finalAnswer,
              sealedCapsules: result.sealedCapsules,
              runLog
            });
            isClosed = true;
            controller.close();
          } catch (error) {
            send({
              type: "error",
              error: error instanceof Error ? error.message : String(error)
            });
            isClosed = true;
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform"
        }
      });
    }

    const result = await runFixedAgentWorkflow(synapse, body.task);
    const runLog = await appendRunLog({
      runId: crypto.randomUUID(),
      task: body.task,
      finalAnswer: result.finalAnswer,
      sealedCapsules: result.sealedCapsules
    });

    return NextResponse.json({
      ok: true,
      ...result,
      runLog
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
