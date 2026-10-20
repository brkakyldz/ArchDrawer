import { CHANNEL_LABELS, CHANNELS, type ChannelId, type Document3 } from "../../core/file3";

const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/** `channel-tabs` (ui contract, Editor frame): the four channels in order, the current one and the marks. */
export function ChannelTabs({ stored, current, onPick }: { stored: Document3; current: ChannelId; onPick: (c: ChannelId) => void }) {
  return (
    <nav className="channel-tabs" data-testid="channel-tabs" aria-label="Channels">
      {CHANNELS.map((c) => {
        const n = stored.channels[c].outdated.length;
        return (
          <button key={c} className="channel-tab" data-testid={`channel-tab-${c}`} aria-current={c === current ? "true" : undefined}
            {...(n ? { "data-outdated": String(n) } : {})} onClick={() => onPick(c)}>
            {CHANNEL_LABELS[c]}
            {n > 0 && <span className="mark" data-testid={`channel-outdated-${c}`} role="img" aria-label={`Needs update: ${changes(n)}`} />}
          </button>
        );
      })}
    </nav>
  );
}

/** `channel-outdated` (ui contract, Channels): what changed in the facts since the channel was drawn. */
export function OutdatedBanner({ count, onKeep }: { count: number; onKeep: () => void }) {
  return (
    <div className="channel-outdated" data-testid="channel-outdated" role="status">
      <span>{changes(count)} in the facts since this was drawn</span>
      <button className="btn small" data-testid="channel-keep" onClick={onKeep}>Keep as it is</button>
    </div>
  );
}

/** `channel-empty` (ui contract, Channels): the stage of a channel with no drawing. */
export function EmptyStage({ channel }: { channel: ChannelId }) {
  return (
    <div className="channel-empty" data-testid="channel-empty" role="status">
      <p>{channel === "linkedin" ? "The LinkedIn post is not drawn yet" : "This channel comes in 0.3"}</p>
    </div>
  );
}
