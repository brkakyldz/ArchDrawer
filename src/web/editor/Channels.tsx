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

/**
 * `channel-outdated` (ui contract, Channels): what changed in the facts since the channel was drawn;
 * keep it as it is, or (the LinkedIn channel) redraw it from the facts.
 */
export function OutdatedBanner({ count, onKeep, onRedraw, busy = false }: { count: number; onKeep: () => void; onRedraw?: () => void; busy?: boolean }) {
  return (
    <div className="channel-outdated" data-testid="channel-outdated" role="status">
      <span>{changes(count)} in the facts since this was drawn</span>
      {onRedraw && <button className="btn small primary" data-testid="channel-redraw" disabled={busy} onClick={onRedraw}>Redraw it</button>}
      <button className="btn small" data-testid="channel-keep" disabled={busy} onClick={onKeep}>Keep as it is</button>
    </div>
  );
}

/** `channel-empty` (ui contract, Channels): the stage of a channel with no drawing, and how to draw it. */
export function EmptyStage({ channel, children }: { channel: ChannelId; children?: React.ReactNode }) {
  return (
    <div className="channel-empty" data-testid="channel-empty">
      <div className="box">
        <p role="status">{channel === "linkedin" ? "The LinkedIn post is not drawn yet" : "This channel comes in 0.3"}</p>
        {children}
      </div>
    </div>
  );
}
