/** Native fixed-size counters; absent/null snapshots are not measured zeroes.
 * JSON u64 values follow the existing number contract and are not exact above MAX_SAFE_INTEGER.
 */
export interface LiveStageTiming {
    attempts: number;
    succeeded: number;
    failed: number;
    empty: number;
    totalMicros: number;
    maxMicros: number;
}

export interface LiveCpuAdmissionSnapshot {
    granted: number;
    policyDenied: number;
    lockUnavailable: number;
}

export interface LiveReadbackTiming {
    stagingCopy: LiveStageTiming;
    mapRgb: LiveStageTiming;
}

export interface LiveCaptureTiming {
    cpuAdmission: LiveCpuAdmissionSnapshot | null;
    readback: LiveReadbackTiming;
    handoff: LiveStageTiming;
    jpegEncode: LiveStageTiming;
    frameStore: LiveStageTiming;
}

export interface LiveRelaySourceTiming {
    socketService: LiveStageTiming;
    latestFrame: LiveStageTiming;
    adaptation: LiveStageTiming;
    socketSend: LiveStageTiming;
}
