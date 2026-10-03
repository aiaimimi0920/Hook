// Local IPC reads must not consume the relay's independently owned latest snapshot.
#[test]
fn live_frame_local_read_preserves_latest_for_relay() {
    let dropped = std::sync::atomic::AtomicU64::new(0);
    let mut buffer = LiveCaptureFrameBuffer::new();
    buffer.push(frame(1), &dropped);
    assert_eq!(buffer.take_bytes_for(1).unwrap().as_slice(), &[1]);
    assert!(buffer.latest_after(0).is_none());
    assert!(buffer.take_bytes_for(1).is_none());
    let relay = buffer
        .clone_latest_after(0)
        .expect("local read consumed relay frame");
    assert_eq!(relay.descriptor.frame_id, 1);
    assert_eq!(relay.bytes.as_slice(), &[1]);
    assert!(buffer.clone_latest_after(1).is_none());
}

#[test]
fn live_frame_relay_snapshot_and_local_read_share_immutable_bytes() {
    let dropped = std::sync::atomic::AtomicU64::new(0);
    let mut buffer = LiveCaptureFrameBuffer::new();
    buffer.push(frame(1), &dropped);
    let relay = buffer.clone_latest_after(0).unwrap();
    let peer = buffer.clone_latest_after(0).unwrap();
    let local = buffer.take_bytes_for(1).unwrap();
    assert!(Arc::ptr_eq(&relay.bytes, &peer.bytes));
    assert!(Arc::ptr_eq(&relay.bytes, &local));
    // IPC ownership cannot mutate the retained relay snapshot.
    let mut ipc = Arc::unwrap_or_clone(local);
    ipc[0] = 99;
    assert_eq!(relay.bytes.as_slice(), &[1]);
    buffer.push(frame(2), &dropped);
    assert_eq!(buffer.clone_latest_after(1).unwrap().bytes.as_slice(), &[2]);
    assert_eq!(relay.bytes.as_slice(), &[1]);
}

#[test]
fn live_frame_latest_snapshot_stays_bounded_across_local_reads_and_eviction() {
    let dropped = std::sync::atomic::AtomicU64::new(0);
    let mut buffer = LiveCaptureFrameBuffer::new();
    for id in 1..=6 {
        buffer.push(frame(id), &dropped);
        assert!(buffer.frames.len() <= LIVE_CAPTURE_FRAME_BUFFER);
        let relay = buffer.clone_latest_after(0).unwrap();
        assert!(Arc::ptr_eq(
            &relay.bytes,
            &buffer.frames.back().unwrap().bytes
        ));
    }
    assert_eq!(dropped.load(std::sync::atomic::Ordering::Relaxed), 3);
    assert!(buffer.take_bytes_for(3).is_none());
    buffer.take_bytes_for(6).unwrap();
    assert!(buffer.frames.is_empty());
    assert_eq!(buffer.clone_latest_after(0).unwrap().descriptor.frame_id, 6);
    for id in 7..=100 {
        buffer.push(frame(id), &dropped);
        buffer.take_bytes_for(id).unwrap();
        assert!(buffer.frames.is_empty());
        assert_eq!(
            buffer
                .clone_latest_after(id - 1)
                .unwrap()
                .descriptor
                .frame_id,
            id
        );
    }
    assert_eq!(dropped.load(std::sync::atomic::Ordering::Relaxed), 3);
}

#[test]
fn live_frame_clear_releases_owned_snapshots_but_not_inflight_consumers() {
    let dropped = std::sync::atomic::AtomicU64::new(0);
    let mut buffer = LiveCaptureFrameBuffer::new();
    buffer.push(frame(1), &dropped);
    let relay = buffer.clone_latest_after(0).unwrap();
    let weak = Arc::downgrade(&relay.bytes);
    let local = buffer.take_bytes_for(1).unwrap();
    buffer.clear();
    assert!(buffer.clone_latest_after(0).is_none());
    assert!(buffer.latest_after(0).is_none());
    assert!(buffer.take_bytes_for(1).is_none());
    drop(local);
    assert!(weak.upgrade().is_some());
    drop(relay);
    assert!(weak.upgrade().is_none());
}

#[test]
fn live_frame_old_unshared_local_read_can_move_without_copying() {
    let dropped = std::sync::atomic::AtomicU64::new(0);
    let mut buffer = LiveCaptureFrameBuffer::new();
    buffer.push(frame(1), &dropped);
    buffer.push(frame(2), &dropped);
    let local = buffer.take_bytes_for(1).unwrap();
    let bytes = Arc::try_unwrap(local).expect("old unshared frame should keep its move path");
    assert_eq!(bytes, vec![1]);
    assert_eq!(buffer.latest_after(0).unwrap().frame_id, 2);
}
