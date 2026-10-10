use super::*;
use crate::loom_hook::LoomHook;
use std::{io::Read, net::TcpListener, sync::mpsc, time::Instant};

#[test]
fn stop_interrupts_blocked_socket_joins_and_resets_listener_state() {
    let hook = LoomHook::new();
    hook.state.lock().unwrap().listener_started = true;
    hook.state.lock().unwrap().backend_connected = true;
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let peer = TcpStream::connect(server.local_addr().unwrap()).unwrap();
    let (mut socket, _) = server.accept().unwrap();
    // Match BridgeStream.application: bound the original reader, not its clone.
    socket
        .set_read_timeout(Some(Duration::from_millis(250)))
        .unwrap();
    let (ready, receive) = mpsc::sync_channel(1);
    let task = ListenerTask::spawn(hook.state.clone(), move |control| {
        control.attach(socket.try_clone().unwrap()).unwrap();
        ready.send(()).unwrap();
        let mut bytes = [0u8; 1];
        let _ = socket.read(&mut bytes);
        assert!(control.cancelled());
    })
    .unwrap();
    receive.recv_timeout(Duration::from_secs(2)).unwrap();
    let start = Instant::now();
    drop(task);
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(!hook.state.lock().unwrap().listener_started);
    assert!(!hook.state.lock().unwrap().backend_connected);
    drop(peer);
}

#[test]
fn stop_wakes_reconnect_backoff_and_late_attach_fails_closed() {
    let hook = LoomHook::new();
    let (ready, receive) = mpsc::sync_channel(1);
    let task = ListenerTask::spawn(hook.state.clone(), move |control| {
        ready.send(()).unwrap();
        control.wait(Duration::from_secs(60));
        assert!(control.cancelled());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        assert!(control.attach(stream).is_err());
    })
    .unwrap();
    receive.recv_timeout(Duration::from_secs(2)).unwrap();
    let start = Instant::now();
    drop(task);
    assert!(start.elapsed() < Duration::from_secs(2));
}
