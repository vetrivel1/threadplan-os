/**
 * Toggles for the fidelity improvements added by the MCOE work.
 *
 * Every flag defaults to on. `LEGACY_PHYSICS` reproduces the pre-MCOE scheduler
 * exactly, which is what the parity check in scripts/verify-parity.ts asserts
 * against the captured golden baseline. Keeping these switchable also lets the
 * benchmark attribute a change in output to a specific modelling decision
 * rather than to the optimizer as a whole.
 */
export interface PhysicsOptions {
  /** Deduct setup minutes when a line switches style. */
  changeover: boolean;
  /** Carry partial learning into repeat runs of a style on the same line. */
  learningRetention: boolean;
  /** Derive the learning curve from the style's complexity tier when no explicit curve exists. */
  complexityCurves: boolean;
  /** Gate on the latest material date plus a buffer rather than a single raw date. */
  rmBuffer: boolean;
  /**
   * Track which sizes each cell produces, so cartons can be shown as closeable
   * or stranded. Off leaves cells byte-identical to the pre-pack-ratio plan.
   */
  packRatioSequencing: boolean;
  /**
   * Run one colour at a time on a line and charge the rethread when it
   * switches. Requires `packRatioSequencing`, which supplies the colourways.
   */
  colourChangeover: boolean;
  /**
   * Run each order through its style's route instead of the fixed four
   * stages. Off treats every style as if it ran all of `STAGE_ORDER`, which is
   * what the four hardcoded stages amounted to before routes existed.
   */
  configuredRouting: boolean;
}

export const DEFAULT_PHYSICS: PhysicsOptions = {
  changeover: true,
  learningRetention: true,
  complexityCurves: true,
  rmBuffer: true,
  packRatioSequencing: true,
  colourChangeover: true,
  configuredRouting: true,
};

export const LEGACY_PHYSICS: PhysicsOptions = {
  changeover: false,
  learningRetention: false,
  complexityCurves: false,
  rmBuffer: false,
  packRatioSequencing: false,
  colourChangeover: false,
  configuredRouting: false,
};

export function resolvePhysics(
  partial?: Partial<PhysicsOptions>
): PhysicsOptions {
  return { ...DEFAULT_PHYSICS, ...partial };
}
