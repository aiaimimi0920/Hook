export class LiveSequenceTracker {
  private controlSequence = 0;
  private frameId = 0;
  private inputSequence = 0;

  constructor(private epoch: number) {
    assertPositiveInteger(epoch, "epoch");
  }

  acceptControl(epoch: number, sequence: number): void {
    this.assertEpoch(epoch);
    assertPositiveInteger(sequence, "sequence");
    if (this.controlSequence === Number.MAX_SAFE_INTEGER) throw new Error("control sequence exhausted");
    const expected = this.controlSequence + 1;
    if (sequence !== expected) throw new Error(`invalid control sequence: expected ${expected}, received ${sequence}`);
    this.controlSequence = sequence;
  }

  acceptInput(epoch: number, sequence: number): void {
    this.assertEpoch(epoch);
    assertPositiveInteger(sequence, "sequence");
    if (this.inputSequence === Number.MAX_SAFE_INTEGER) throw new Error("input sequence exhausted");
    const expected = this.inputSequence + 1;
    if (sequence !== expected) throw new Error(`invalid input sequence: expected ${expected}, received ${sequence}`);
    this.inputSequence = sequence;
  }

  acceptFrame(epoch: number, frameId: number): number {
    this.assertEpoch(epoch);
    assertPositiveInteger(frameId, "frameId");
    if (frameId <= this.frameId) throw new Error(`stale frame: ${frameId}`);
    const dropped = Math.max(0, frameId - this.frameId - 1);
    this.frameId = frameId;
    return dropped;
  }

  resume(epoch: number, controlSequence: number, frameId: number, inputSequence: number): void {
    if (!Number.isSafeInteger(epoch) || epoch <= this.epoch) throw new Error("resume requires a newer epoch");
    for (const [value, field] of [
      [controlSequence, "controlSequence"],
      [frameId, "frameId"],
      [inputSequence, "inputSequence"],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${field}`);
    }
    this.epoch = epoch;
    this.controlSequence = controlSequence;
    this.frameId = frameId;
    this.inputSequence = inputSequence;
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new Error(`stale live epoch: ${epoch}`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${field}`);
}
