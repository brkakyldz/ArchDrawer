import type { ChannelId } from "../core/file3";
import { parseIntent, storyProblems, type StoryIntent } from "../core/intent";
import { repairPrompt } from "./engines/prompt";
import { EngineError } from "./engines/types";

/**
 * A story answer through its one repair turn (diagram contract, Problems and the repair turn): an
 * answer with problems goes back to the engine once, with the list, and the second answer replaces
 * it. What is still wrong is then the conversion's to repair or to fail (`intentToChannel`). An
 * answer that does not match the schema's shape fails at once.
 */
export async function storyAnswer(first: unknown, o: {
  channel: ChannelId;
  /** The repair turn's call: the same request with this prompt, no tools and no image. */
  repair: (prompt: string) => Promise<unknown>;
  progress: (m: string) => void;
  /** The check line said after the answer (api contract, Progress); none for a draw's overview. */
  check: string | null;
  signal: AbortSignal;
}): Promise<StoryIntent> {
  const intent = parseIntent(first);
  const problems = storyProblems(intent, o.channel);
  if (!problems.length) return intent;
  o.progress(`Fixing ${problems.length} problem${problems.length === 1 ? "" : "s"} in the answer`);
  const second = await o.repair(repairPrompt({ channel: o.channel, answer: first, problems }));
  if (o.signal.aborted) throw new EngineError("Cancelled");
  if (o.check) o.progress(o.check);
  return parseIntent(second);
}
