import "server-only";
import {
  getInstituteStatusModel,
  type InstituteStatusModel,
} from "@/lib/institute-status-report";
import {
  pipelineRangeSchema,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";

export type OverviewPipelineResult =
  | { ok: true; model: InstituteStatusModel; range: PipelineRange }
  | { ok: false; error: string; badRange: boolean };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The pipeline model for the admin Overview's `?from=&to=`.
 *
 * The same schema and the same model `/institutes/report` uses, so the card and
 * the full pipeline cannot count differently. No sort: sorting is that
 * screen's, and the model falls back to its default order without one.
 */
export async function getOverviewPipeline(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<OverviewPipelineResult> {
  const parsed = pipelineRangeSchema.safeParse({
    from: first(searchParams.from),
    to: first(searchParams.to),
  });
  if (!parsed.success) {
    return {
      ok: false,
      badRange: true,
      error:
        parsed.error.issues[0]?.message ??
        "That date range is not one we can report on.",
    };
  }

  const result = await getInstituteStatusModel({ range: parsed.data });
  if (!result.ok) return { ok: false, badRange: false, error: result.error };
  return { ok: true, model: result.model, range: parsed.data };
}
