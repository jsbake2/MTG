// Replacement-effect framework, modeled on XMage's CR-614/616 selection loop.
// Generic over an event type. Each effect: a cheap type pre-filter, a full
// applicability test, and a mutate-the-event replace(). The loop tracks which
// effects already applied (on the event), lets the affected player choose order
// when several apply, and stops when the event is fully consumed. Replaces the
// scattered one-off ETB hacks with one proven mechanism.

export interface ReplEvent {
  type: string;
  appliedIds: string[]; // ids of replacement effects already applied to THIS event
  consumed?: boolean; // set true when an effect fully replaces (prevents) the event
}

export interface ReplacementEffect<E extends ReplEvent> {
  id: string;
  checksEventType: (e: E) => boolean; // cheap pre-filter
  applies: (e: E) => boolean; // full applicability test
  // Mutate the event in place (e.g. entersTapped) and/or set e.consumed for a
  // full replacement (e.g. "if you would draw, win instead"). May return void.
  replace: (e: E) => void;
}

// Default order chooser: earliest-registered wins. Real engines let the affected
// player choose; pass your own chooser to do that.
export type OrderChooser<E extends ReplEvent> = (applicable: ReplacementEffect<E>[], e: E) => ReplacementEffect<E>;

const firstChooser = <E extends ReplEvent>(a: ReplacementEffect<E>[]): ReplacementEffect<E> => a[0]!;

// Run the replacement loop over an event. Returns the (mutated) event. Each
// effect applies at most once (CR 616.1); the loop re-evaluates applicability
// after each application because a replacement can expose new ones.
export function applyReplacements<E extends ReplEvent>(
  event: E,
  effects: ReplacementEffect<E>[],
  chooseOrder: OrderChooser<E> = firstChooser,
): E {
  event.appliedIds = event.appliedIds ?? [];
  // Guard against pathological loops (mirrors XMage's bounded re-evaluation).
  for (let guard = 0; guard < 100; guard++) {
    if (event.consumed) break;
    const applicable = effects.filter(
      (r) => !event.appliedIds.includes(r.id) && r.checksEventType(event) && r.applies(event),
    );
    if (applicable.length === 0) break;
    const chosen = applicable.length === 1 ? applicable[0]! : chooseOrder(applicable, event);
    event.appliedIds.push(chosen.id);
    chosen.replace(event);
  }
  return event;
}
